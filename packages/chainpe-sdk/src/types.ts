import type { TokenSymbol } from './networks.js'

/** Network the SDK operates on: Arbitrum One (mainnet) or Arbitrum Sepolia (testnet). */
export type ChainPeNetwork = 'arbitrum' | 'arbitrum-sepolia'

/**
 * Error thrown when an x402 payment fails on-chain (e.g. insufficient USDC,
 * settlement revert). Provides `.txHash` and `.reason` for debugging.
 */
export class ChainPePaymentError extends Error {
  readonly txHash?: string
  readonly reason?: string

  constructor(
    message: string,
    { txHash, reason }: { txHash?: string; reason?: string } = {}
  ) {
    super(message)
    this.name = 'ChainPePaymentError'
    this.txHash = txHash
    this.reason = reason
  }
}

/** Options for constructing a {@link ChainPe} client. */
export interface ChainPeOptions {
  /** EOA private key (0x-prefixed or bare hex) used to sign payments + feedback. */
  privateKey: string
  /**
   * Network. Defaults to `'arbitrum'` (Arbitrum One mainnet).
   * Pass `'arbitrum-sepolia'` explicitly to target testnet.
   */
  network?: ChainPeNetwork
  /**
   * ChainPeRegistry address. Defaults to `CHAINPE_REGISTRY_ADDRESS` or the
   * deployed registry for the network. Only needed for discovery and
   * registry-based feedback resolution.
   */
  registryAddress?: string
  /** ERC-8004 Reputation Registry address. Defaults to the canonical registry for the network. */
  reputationRegistry?: string
  /**
   * @deprecated Unused by the payment flow: the provider's proxy chooses the
   * facilitator (with failover) and settles the payment, so payers never call
   * a facilitator. Still echoed via {@link ChainPe.config}; will be removed in
   * the next major version.
   */
  facilitatorUrl?: string
  /**
   * Max USDC to auto-pay for a single 402 (human units, e.g. `"1.00"`).
   * The payment is refused on-chain if a 402 demands more. Defaults to `"1"`.
   */
  maxPerCall?: string
  /**
   * When true, `.fetch()`/`.pay()` post positive ERC-8004 feedback to the
   * provider's agent after a successful paid call. Defaults to `false`
   * (opt-in, since resolving the agent scans the registry). `.pay()` returns
   * the feedback result; use `.giveFeedback()` for explicit control.
   */
  autoFeedback?: boolean
  /**
   * ChainPe indexer base URL, read for payment-verified reputation. Defaults
   * to `CHAINPE_INDEXER_URL`; without one, scores come from the chain unverified.
   */
  indexerUrl?: string
}

/** Per-request options for {@link ChainPe.fetch} / {@link ChainPe.pay}. */
export interface FetchOptions extends RequestInit {
  /** Override the constructor `autoFeedback` for this call. */
  autoFeedback?: boolean
  /**
   * Request timeout in milliseconds. Aborts the fetch if the server does not
   * respond within this window. Defaults to 30 000 ms (30 s).
   */
  timeout?: number
}

/** Where a discovered service came from. */
export type ServiceSource = 'registry' | 'bazaar' | 'erc8004'

/** A discovered x402 service. */
export interface ChainPeService {
  /** Stable id: `developer:name` (registry) or `<source>:<endpoint>`. */
  id: string
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string
  paymentToken: TokenSymbol
  /** Address that receives payment (the 402 `payTo`). */
  walletAddress: string
  network: ChainPeNetwork
  /** Registering address; for Bazaar and ERC-8004 results, the `payTo`. */
  developer: string
  /** ChainPeRegistry, Coinbase's x402 Bazaar, or an ERC-8004 registration file. */
  source: ServiceSource
  /** ERC-8004 agent id, when the service is linked to an identity. */
  agentId?: string
  createdAt?: string
  updatedAt?: string
}

/** Filters for {@link ChainPe.discover}. */
export interface DiscoverOptions {
  /** Free-text match over name/description/tags. */
  query?: string
  tags?: string[]
  /** Max price per request (human USDC units). */
  maxPrice?: string
  /** Sources to query. Default: all three. */
  sources?: ServiceSource[]
  /**
   * Extra ERC-8004 agent ids whose registration files to read, on top of the
   * agent ids of services found in the registry and the Bazaar.
   */
  agentIds?: string[]
}

/** Aggregated ERC-8004 reputation for an agent. */
export interface ReputationSummary {
  /** Number of distinct clients that left feedback. */
  count: number
  /** Aggregate score (typically 0–100), or null when unscored. */
  score: number | null
  /**
   * True when the score comes from the ChainPe indexer and counts only
   * reviewers whose feedback proves a payment to the service. False for the
   * raw on-chain summary, which fresh wallets can inflate.
   */
  verified: boolean
  /** Indexer only: feedback left out of the score for lacking a valid payment proof. */
  unverifiedCount?: number
}

/** A service annotated with its reputation (returned by {@link ChainPe.discover}). */
export interface RankedService extends ChainPeService {
  reputation: ReputationSummary | null
}

/** Settlement details decoded from the `PAYMENT-RESPONSE` header. */
export interface PaymentInfo {
  amount: string
  /** Stablecoin the payment was made in. */
  token: TokenSymbol
  recipient: string
  network: ChainPeNetwork
  /** On-chain settlement tx hash, when the provider reported one. */
  txHash?: string
  settlement?: unknown
}

/** Result of {@link ChainPe.pay} — a parsed, structured paid response. */
export interface PaidResult<T = unknown> {
  status: number
  ok: boolean
  headers: Record<string, string>
  /** Parsed body (JSON when the content-type is JSON, else text). */
  data: T
  /** Present when a payment was made + settled. */
  payment?: PaymentInfo
  /** Present when feedback was posted (autoFeedback). */
  reputation?: { agentId: string; score: number; txHash: string }
}

/** Wallet balances (human units). */
export interface Balances {
  usdc: string
  /** Native gas token (ETH on Arbitrum). */
  eth: string
}
