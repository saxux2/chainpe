/**
 * ChainPe — x402 payments + ERC-8004 reputation in a few lines.
 *
 *   const cp = new ChainPe({ privateKey, network: 'arbitrum-sepolia' })
 *   const res = await cp.fetch('https://api.example.com/paid')   // auto-pays a 402
 *   const data = await res.json()
 */
import {
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
  getAddress,
  type Address
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import type { PaymentRequired } from '@x402/core/types'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { createPermit2ApprovalTx } from '@x402/evm'
import {
  publicClientFor,
  getUsdcAddress,
  getX402Network,
  getToken,
  findTokenByAddress,
  chainFor,
  rpcUrlFor,
  findRegistryAddress,
  resolveReputationRegistry,
  resolveIdentityRegistry,
  normalizeKey,
  USDC_DECIMALS
} from './networks.js'
import { discoverServices } from './discovery.js'
import { getReputation, giveFeedback, submitPaidCallFeedback } from './reputation.js'
import type { FeedbackPayment } from './reputation.js'
import type { TokenSymbol } from './networks.js'
import type {
  ChainPeNetwork,
  ChainPeOptions,
  FetchOptions,
  DiscoverOptions,
  RankedService,
  ReputationSummary,
  PaidResult,
  PaymentInfo,
  Balances
} from './types.js'
import { ChainPePaymentError } from './types.js'

/** ChainPe extension (3b) carried on the 402 body: the provider's ERC-8004 agent id. */
interface ChainPeBodyExtension {
  agentId?: string
}

/** Internal result of a paid request: a live (unconsumed) Response + metadata. */
interface PaidRequest {
  response: Response
  /** Set when a payment was actually made. */
  payment?: PaymentInfo
  /** The selected 402 offer, when payment occurred. */
  payTo?: string
  /** Provider's ERC-8004 agent id, advertised on the 402 (3b). */
  agentId?: string
}

export class ChainPe {
  readonly network: ChainPeNetwork
  /** ChainPeRegistry address, when configured (needed for discovery). */
  readonly registryAddress?: `0x${string}`
  readonly reputationRegistry: `0x${string}`

  private readonly privateKey: string
  private readonly account: Address
  private readonly maxPerCallAtomic: bigint
  private readonly autoFeedback: boolean
  private readonly facilitatorUrl?: string
  private readonly indexerUrl?: string
  private httpClient?: x402HTTPClient

  constructor(options: ChainPeOptions) {
    if (!options.privateKey) {
      throw new Error('ChainPe: `privateKey` is required.')
    }
    this.privateKey = options.privateKey
    this.network = options.network ?? 'arbitrum'
    this.registryAddress = findRegistryAddress(
      this.network,
      options.registryAddress
    )
    this.reputationRegistry = resolveReputationRegistry(
      this.network,
      options.reputationRegistry
    )
    this.account = privateKeyToAccount(normalizeKey(this.privateKey)).address
    this.maxPerCallAtomic = parseUnits(
      options.maxPerCall ?? '1',
      USDC_DECIMALS
    )
    this.autoFeedback = options.autoFeedback ?? false
    this.facilitatorUrl = options.facilitatorUrl
    this.indexerUrl = options.indexerUrl
  }

  /** Echoes the resolved configuration (no secrets). */
  get config() {
    return {
      network: this.network,
      address: this.account,
      registryAddress: this.registryAddress,
      reputationRegistry: this.reputationRegistry,
      facilitatorUrl: this.facilitatorUrl,
      maxPerCall: formatUnits(this.maxPerCallAtomic, USDC_DECIMALS)
    }
  }

  /** The wallet address that signs payments and feedback. */
  getAddress(): string {
    return this.account
  }

  /** Reads on-chain USDC + native ETH balances (human units). */
  async balance(): Promise<Balances> {
    const client = publicClientFor(this.network)
    const address = getAddress(this.account)
    const [usdcRaw, wei] = await Promise.all([
      client
        .readContract({
          address: getUsdcAddress(this.network),
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address]
        })
        .catch(() => 0n) as Promise<bigint>,
      client.getBalance({ address }).catch(() => 0n)
    ])
    return {
      usdc: formatUnits(usdcRaw, USDC_DECIMALS),
      eth: formatUnits(wei, 18)
    }
  }

  /**
   * Drop-in `fetch` that automatically pays an x402 `402 Payment Required`
   * (USDC via EIP-3009) and returns the final live {@link Response}.
   */
  async fetch(url: string, opts: FetchOptions = {}): Promise<Response> {
    const { result, autoFeedback } = await this.execute(url, opts)
    if (result.payment && (autoFeedback ?? this.autoFeedback)) {
      await this.tryAutoFeedback(url, result)
    }
    return result.response
  }

  /**
   * Like {@link fetch}, but returns a structured, body-parsed result with the
   * payment + (optional) reputation details. Convenient for agents.
   */
  async pay<T = unknown>(
    url: string,
    opts: FetchOptions = {}
  ): Promise<PaidResult<T>> {
    const { result, autoFeedback } = await this.execute(url, opts)
    const { response } = result

    let reputation: PaidResult<T>['reputation']
    if (result.payment && (autoFeedback ?? this.autoFeedback)) {
      reputation = await this.tryAutoFeedback(url, result)
    }

    const data = (await this.parseBody(response)) as T
    return {
      status: response.status,
      ok: response.ok,
      headers: headersToObject(response.headers),
      data,
      payment: result.payment,
      reputation
    }
  }

  /**
   * Discovers services from the ChainPe registry (when configured), Coinbase's
   * x402 Bazaar and ERC-8004 registration files, de-duplicated by endpoint,
   * annotated with ERC-8004 reputation and ranked (scored first, higher score
   * first). Pass a search string or filters.
   */
  async discover(
    query: string | DiscoverOptions = {}
  ): Promise<RankedService[]> {
    const options: DiscoverOptions =
      typeof query === 'string' ? { query } : query
    return discoverServices(this.network, options, {
      registryAddress: this.registryAddress,
      reputationRegistry: this.reputationRegistry,
      identityRegistry: resolveIdentityRegistry(this.network),
      indexerUrl: this.indexerUrl
    })
  }

  /**
   * Reads a provider agent's aggregate ERC-8004 reputation: payment-verified
   * from the indexer when one is configured, else the raw on-chain summary.
   */
  async getReputation(agentId: string): Promise<ReputationSummary | null> {
    return getReputation(this.network, this.reputationRegistry, agentId, {
      indexerUrl: this.indexerUrl
    })
  }

  /**
   * Posts ERC-8004 feedback (0–100) for a provider agent. Pass `payment` (the
   * settlement tx and `payTo` from {@link PaymentInfo}) so indexers can count
   * it as a paying review. Returns the tx hash.
   */
  async giveFeedback(
    agentId: string,
    score: number,
    opts: {
      endpoint?: string
      tag?: string
      payment?: FeedbackPayment
      waitConfirm?: boolean
    } = {}
  ): Promise<string> {
    return giveFeedback(
      this.network,
      this.reputationRegistry,
      this.privateKey,
      { agentId, value: score, ...opts }
    )
  }

  /**
   * One-time ERC-20 approval to the canonical Permit2 contract, needed before
   * paying in a token whose `transferMethod` is `permit2`. EIP-3009 tokens
   * (USDC, USDT0 on Arbitrum) never need this. Returns the tx hash.
   */
  async approvePermit2(token: TokenSymbol | `0x${string}`): Promise<string> {
    const address = token.startsWith('0x')
      ? getAddress(token)
      : getToken(this.network, token as TokenSymbol).address
    const account = privateKeyToAccount(normalizeKey(this.privateKey))
    const wallet = createWalletClient({
      account,
      chain: chainFor(this.network),
      transport: http(rpcUrlFor(this.network))
    })
    const tx = createPermit2ApprovalTx(address)
    const hash = await wallet.sendTransaction({ account, chain: chainFor(this.network), ...tx })
    await publicClientFor(this.network).waitForTransactionReceipt({ hash })
    return hash
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private ensureHttpClient(): x402HTTPClient {
    if (!this.httpClient) {
      const account = privateKeyToAccount(normalizeKey(this.privateKey))
      // `maxPerCall` is enforced in execute(), so disable x402's default $1 cap.
      const client = new x402Client()
        .register(getX402Network(this.network), new ExactEvmScheme(account))
        .setSpendControls(false)
      this.httpClient = new x402HTTPClient(client)
    }
    return this.httpClient
  }

  /**
   * Runs the x402 v2 flow manually so we can surface the payment metadata and
   * the `payTo` (needed to resolve the provider's agent for feedback): initial
   * request → on 402, select the offer for our network, enforce `maxPerCall`,
   * sign, retry with `PAYMENT-SIGNATURE`.
   */
  private async execute(
    url: string,
    opts: FetchOptions
  ): Promise<{ result: PaidRequest; autoFeedback?: boolean }> {
    const { autoFeedback, timeout = 30_000, ...init } = opts

    // Wraps fetch with an AbortController timeout so hung servers don't stall forever.
    const fetchWithTimeout = (input: string, options: RequestInit) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      return fetch(input, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer))
    }

    const initial = await fetchWithTimeout(url, init)
    if (initial.status !== 402) {
      return { result: { response: initial }, autoFeedback }
    }

    const httpClient = this.ensureHttpClient()
    const body = (await initial.json().catch(() => undefined)) as
      | (Partial<PaymentRequired> & ChainPeBodyExtension)
      | undefined

    let paymentRequired: PaymentRequired
    try {
      paymentRequired = httpClient.getPaymentRequiredResponse(
        name => initial.headers.get(name),
        body
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`x402: could not parse the 402 response from ${url} — ${msg}`)
    }

    const caip2 = getX402Network(this.network)
    const onNetwork = paymentRequired.accepts.filter(
      a => a.network === caip2 && a.scheme === 'exact'
    )
    if (onNetwork.length === 0) {
      const nets = paymentRequired.accepts.map(a => a.network).join(', ') || 'none'
      throw new Error(
        `x402: server accepts [${nets}] but wallet is on ${this.network} (${caip2}).`
      )
    }
    // Only pay in known stablecoins: an unknown `asset` could be any token,
    // and maxPerCall would be meaningless for it.
    const accept = onNetwork.find(a => findTokenByAddress(this.network, a.asset))
    if (!accept) {
      throw new Error(
        `x402: server asks for unsupported token(s) [${onNetwork.map(a => a.asset).join(', ')}] on ${this.network}.`
      )
    }
    const token = findTokenByAddress(this.network, accept.asset)!

    const required = BigInt(accept.amount)
    // Stablecoins only, so maxPerCall (in dollars) applies across tokens.
    const cap = parseUnits(formatUnits(this.maxPerCallAtomic, USDC_DECIMALS), token.decimals)
    if (required > cap) {
      throw new Error(
        `x402: payment of ${formatUnits(required, token.decimals)} ${token.symbol} exceeds maxPerCall ` +
          `${formatUnits(this.maxPerCallAtomic, USDC_DECIMALS)} for ${url}.`
      )
    }

    let paymentHeaders: Record<string, string>
    try {
      const payload = await httpClient.createPaymentPayload({
        ...paymentRequired,
        accepts: [accept]
      })
      paymentHeaders = httpClient.encodePaymentSignatureHeader(payload)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new ChainPePaymentError(`x402: failed to sign payment — ${msg}`, { reason: msg })
    }

    const retryHeaders = new Headers(init.headers)
    for (const [name, value] of Object.entries(paymentHeaders)) {
      retryHeaders.set(name, value)
    }
    const paid = await fetchWithTimeout(url, { ...init, headers: retryHeaders })

    if (paid.status === 402) {
      throw new ChainPePaymentError(
        `x402: payment signed but the server could not settle (needs ${token.symbol} on ${this.network}` +
          (token.transferMethod === 'permit2' ? `, and a Permit2 approval — call approvePermit2('${token.symbol}')` : '') +
          `). Attempted ${formatUnits(required, token.decimals)} ${token.symbol} → ${accept.payTo}.`,
        { reason: 'settlement_rejected' }
      )
    }

    // 3b: prefer the provider-advertised agent id (header → body → offer extra)
    // so feedback skips the registry scan.
    const advertisedAgentId =
      initial.headers.get('x-chainpe-agent-id') ??
      body?.agentId ??
      (accept.extra?.agentId as string | undefined)

    const payment: PaymentInfo = {
      amount: formatUnits(required, token.decimals),
      token: token.symbol,
      recipient: accept.payTo,
      network: this.network
    }
    try {
      const settlement = httpClient.getPaymentSettleResponse(name => paid.headers.get(name))
      payment.settlement = settlement
      payment.txHash = settlement.transaction || undefined
    } catch {
      /* no (or undecodable) settlement header */
    }

    return {
      result: {
        response: paid,
        payment,
        payTo: accept.payTo,
        agentId: advertisedAgentId
      },
      autoFeedback
    }
  }

  /**
   * Best-effort positive feedback for the provider's agent after a paid call,
   * with the settlement as proof of payment. Never throws.
   */
  private async tryAutoFeedback(
    url: string,
    paid: PaidRequest
  ): Promise<{ agentId: string; score: number; txHash: string } | undefined> {
    if (!paid.payTo) return undefined
    const res = await submitPaidCallFeedback(
      this.network,
      this.reputationRegistry,
      this.privateKey,
      {
        url,
        payTo: paid.payTo,
        txHash: paid.payment?.txHash,
        agentId: paid.agentId,
        registryAddress: this.registryAddress
      }
    )
    return res && { agentId: res.agentId, score: res.score, txHash: res.txHash }
  }

  private async parseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        return await response.json()
      } catch {
        return null
      }
    }
    return response.text()
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}
