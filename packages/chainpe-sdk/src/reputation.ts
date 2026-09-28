/**
 * ERC-8004 reputation — read aggregate scores + post feedback.
 *
 * A provider's score is the aggregate of feedback left by paying clients on the
 * ERC-8004 Reputation Registry. Every feedback carries an off-chain JSON file
 * (inlined as a `data:` URI) whose keccak256 is the on-chain `feedbackHash`; for
 * paid calls the file holds a `proofOfPayment` naming the settlement tx. The
 * ChainPe indexer checks that proof, so its scores count paying reviewers only.
 *
 * The registry blocks self-feedback, so a provider can't rate its own agent —
 * but anyone can create wallets, which is why unverified on-chain summaries are
 * labelled `verified: false`.
 */
import {
  createWalletClient,
  getAddress,
  http,
  keccak256,
  toBytes,
  type Hex,
  type WalletClient
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  publicClientFor,
  rpcUrlFor,
  chainFor,
  normalizeKey,
  getNetworkConfig,
  resolveIdentityRegistry
} from './networks.js'
import { RegistryClient } from './registry.js'
import type { ChainPeNetwork, ReputationSummary } from './types.js'

const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' }
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' }
    ]
  },
  {
    type: 'function',
    name: 'getClients',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }]
  }
] as const

/** Converts the on-chain (value, decimals) summary into a human score. Pure. */
export function summaryToScore(summaryValue: bigint, decimals: number): number {
  return Number(summaryValue) / 10 ** decimals
}

// ─── Feedback files ──────────────────────────────────────────────────────────

/** ERC-8004 `proofOfPayment`: the x402 settlement that entitles the review. */
export interface ProofOfPayment {
  fromAddress: string
  toAddress: string
  chainId: string
  txHash: string
}

/** The off-chain ERC-8004 feedback file (field names follow the spec). */
export interface FeedbackFile {
  agentRegistry: string
  agentId: number | string
  clientAddress: string
  createdAt: string
  value: number
  valueDecimals: number
  tag1: string
  tag2: string
  endpoint?: string
  proofOfPayment?: ProofOfPayment
}

/** JSON with object keys sorted at every level, no whitespace. Pure. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Serialises a feedback file into what goes on-chain: a self-contained
 * `data:` URI and the keccak256 of its exact bytes. Pure.
 */
export function encodeFeedbackFile(file: FeedbackFile): {
  json: string
  feedbackURI: string
  feedbackHash: Hex
} {
  const json = canonicalJson(file)
  const bytes = toBytes(json)
  return {
    json,
    feedbackURI: `data:application/json;base64,${Buffer.from(bytes).toString('base64')}`,
    feedbackHash: keccak256(bytes)
  }
}

// ─── Reading reputation ──────────────────────────────────────────────────────

export interface GetReputationOptions {
  /**
   * ChainPe indexer base URL. Defaults to `CHAINPE_INDEXER_URL`; pass `null`
   * to skip the indexer and read the chain directly.
   */
  indexerUrl?: string | null
  /**
   * On-chain fallback only: the reviewers to aggregate over (e.g. addresses
   * you know paid the provider). Defaults to every client of the agent.
   */
  clients?: string[]
  /** Indexer request timeout (ms). Defaults to 5000. */
  timeout?: number
}

export function resolveIndexerUrl(explicit?: string | null): string | undefined {
  if (explicit === null) return undefined
  const url = explicit ?? process.env.CHAINPE_INDEXER_URL
  return url ? url.replace(/\/+$/, '') : undefined
}

/**
 * Reads a verified score from the ChainPe indexer. Returns undefined when the
 * indexer is unreachable, errors, or indexes a different network.
 */
async function reputationFromIndexer(
  indexerUrl: string,
  network: ChainPeNetwork,
  agentId: string,
  timeout: number
): Promise<ReputationSummary | undefined> {
  try {
    const res = await fetch(`${indexerUrl}/agents/${encodeURIComponent(agentId)}/reputation`, {
      signal: AbortSignal.timeout(timeout)
    })
    if (!res.ok) return undefined
    const body = (await res.json()) as Partial<ReputationSummary> & { network?: string }
    if (body.network !== network || typeof body.count !== 'number') return undefined
    return {
      count: body.count,
      score: typeof body.score === 'number' ? body.score : null,
      verified: true,
      unverifiedCount: body.unverifiedCount ?? 0
    }
  } catch {
    return undefined
  }
}

/**
 * Reads a provider agent's aggregate reputation. Returns null when the agent is
 * unlinked (`agentId` 0/empty) or no registry is configured; `count: 0` when the
 * agent exists but has no feedback yet.
 *
 * With an indexer (`CHAINPE_INDEXER_URL`) the score counts only reviewers whose
 * feedback proves a payment to the service (`verified: true`). Otherwise it is
 * the on-chain `getSummary` over `opts.clients` (default: all clients), which
 * anyone can inflate with fresh wallets (`verified: false`).
 */
export async function getReputation(
  network: ChainPeNetwork,
  registry: `0x${string}` | undefined,
  agentId: string,
  opts: GetReputationOptions = {}
): Promise<ReputationSummary | null> {
  if (!agentId || agentId === '0') return null

  const indexerUrl = resolveIndexerUrl(opts.indexerUrl)
  if (indexerUrl) {
    const fromIndexer = await reputationFromIndexer(
      indexerUrl,
      network,
      agentId,
      opts.timeout ?? 5_000
    )
    if (fromIndexer) return fromIndexer
  }

  if (!registry) return null
  try {
    const client = publicClientFor(network)
    const id = BigInt(agentId)
    let clients = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: 'getClients',
      args: [id]
    })) as readonly `0x${string}`[]

    if (opts.clients) {
      const wanted = new Set(opts.clients.map(c => c.toLowerCase()))
      clients = clients.filter(c => wanted.has(c.toLowerCase()))
    }
    // getSummary reverts on an empty client list.
    if (clients.length === 0) return { count: 0, score: null, verified: false }

    const [count, summaryValue, decimals] = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: 'getSummary',
      args: [id, clients as `0x${string}`[], '', '']
    })) as readonly [bigint, bigint, number]

    return {
      count: Number(count),
      score: summaryToScore(summaryValue, Number(decimals)),
      verified: false
    }
  } catch {
    return null
  }
}

// ─── Posting feedback ────────────────────────────────────────────────────────

/** The x402 payment a feedback refers to. */
export interface FeedbackPayment {
  /** Settlement tx hash (from the `PAYMENT-RESPONSE` header). */
  txHash: string
  /** The 402 offer's `payTo`. */
  payTo: string
}

export interface GiveFeedbackParams {
  agentId: string
  /** Score, typically 0–100 (valueDecimals 0). */
  value: number
  endpoint?: string
  tag?: string
  /** When set, the feedback file carries an ERC-8004 `proofOfPayment`. */
  payment?: FeedbackPayment
  /** Await the receipt before returning. Defaults to false. */
  waitConfirm?: boolean
}

/** Builds the feedback file for `params`, posted from `client`. Pure. */
export function buildFeedbackFile(
  network: ChainPeNetwork,
  client: string,
  params: Omit<GiveFeedbackParams, 'waitConfirm'>,
  createdAt: Date = new Date()
): FeedbackFile {
  const { chainId } = getNetworkConfig(network)
  const id = BigInt(params.agentId)
  return {
    agentRegistry: `eip155:${chainId}:${resolveIdentityRegistry(network)}`,
    agentId: id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id.toString(),
    clientAddress: `eip155:${chainId}:${getAddress(client)}`,
    createdAt: createdAt.toISOString(),
    value: Math.round(params.value),
    valueDecimals: 0,
    tag1: 'x402',
    tag2: params.tag ?? 'paid-call',
    endpoint: params.endpoint || undefined,
    proofOfPayment: params.payment
      ? {
          fromAddress: getAddress(client),
          toAddress: getAddress(params.payment.payTo),
          chainId: String(chainId),
          txHash: params.payment.txHash
        }
      : undefined
  }
}

/** Posts ERC-8004 feedback for a provider agent. Returns the tx hash. */
export async function giveFeedback(
  network: ChainPeNetwork,
  registry: `0x${string}` | undefined,
  privateKey: string,
  params: GiveFeedbackParams
): Promise<string> {
  if (!registry) throw new Error('Reputation registry address not configured')

  const account = privateKeyToAccount(normalizeKey(privateKey))
  const wallet: WalletClient = createWalletClient({
    account,
    chain: chainFor(network),
    transport: http(rpcUrlFor(network))
  })

  const file = buildFeedbackFile(network, account.address, params)
  const { feedbackURI, feedbackHash } = encodeFeedbackFile(file)

  const hash = await wallet.writeContract({
    account,
    chain: chainFor(network),
    address: registry,
    abi: REPUTATION_ABI,
    functionName: 'giveFeedback',
    args: [
      BigInt(params.agentId),
      BigInt(file.value),
      0,
      file.tag1,
      file.tag2,
      params.endpoint ?? '',
      feedbackURI,
      feedbackHash
    ]
  })

  if (params.waitConfirm) {
    await publicClientFor(network).waitForTransactionReceipt({ hash })
  }
  return hash
}

export interface PaidCallFeedbackParams {
  /** The URL that was paid for. */
  url: string
  /** The 402 offer's `payTo`. */
  payTo: string
  /** Settlement tx hash; without it the feedback carries no payment proof. */
  txHash?: string
  /** Agent id advertised by the provider (header, 402 body or offer `extra`). */
  agentId?: string
  /** Service endpoint, when known (defaults to the URL's origin). */
  endpoint?: string
  /** ChainPeRegistry, used to find the agent by `payTo`/URL when none was advertised. */
  registryAddress?: `0x${string}`
  /** Score. Defaults to 100. */
  value?: number
}

/**
 * Best-effort positive feedback after a successful paid call — shared by the
 * SDK, wallet and agent. Uses the advertised agent id, else matches `payTo`
 * (then URL prefix) against the ChainPe registry. Attaches the payment proof
 * when the settlement tx is known. Never throws: returns undefined when there
 * is no agent to rate or the transaction fails (self-feedback, gas, network).
 */
export async function submitPaidCallFeedback(
  network: ChainPeNetwork,
  reputationRegistry: `0x${string}` | undefined,
  privateKey: string,
  params: PaidCallFeedbackParams
): Promise<{ agentId: string; score: number; txHash: string; proofOfPayment: boolean } | undefined> {
  try {
    let agentId = params.agentId
    let endpoint = params.endpoint

    if ((!agentId || agentId === '0') && params.registryAddress) {
      const services = await new RegistryClient(network, params.registryAddress).listAllServices()
      const payTo = params.payTo.toLowerCase()
      const svc =
        services.find(s => s.walletAddress.toLowerCase() === payTo && s.agentId) ??
        services.find(s => params.url.startsWith(s.endpoint) && s.agentId)
      agentId = svc?.agentId
      endpoint = endpoint ?? svc?.endpoint
    }
    if (!agentId || agentId === '0') return undefined

    const value = params.value ?? 100
    const txHash = await giveFeedback(network, reputationRegistry, privateKey, {
      agentId,
      value,
      endpoint: endpoint ?? new URL(params.url).origin,
      tag: 'x402-success',
      payment: params.txHash ? { txHash: params.txHash, payTo: params.payTo } : undefined
    })
    return { agentId, score: value, txHash, proofOfPayment: !!params.txHash }
  } catch {
    return undefined
  }
}
