/**
 * @chainpe/sdk — x402 USDC payments + on-chain ERC-8004 reputation for the
 * Arbitrum agent economy, in a few lines.
 *
 * @example
 * ```ts
 * import { ChainPe } from '@chainpe/sdk'
 *
 * const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY!, network: 'arbitrum-sepolia' })
 * const res = await cp.fetch('https://api.example.com/paid')
 * console.log(await res.json())
 * ```
 */
export { ChainPe } from './chainpe.js'

export {
  RegistryClient,
  filterServices,
  rankByReputation,
  decodeService
} from './registry.js'
export type { RawService } from './registry.js'

export { discoverServices, dedupeByEndpoint, endpointKey } from './discovery.js'
export type { DiscoveryContext } from './discovery.js'
export { searchBazaar, bazaarResourceToService, CDP_BAZAAR_URL } from './bazaar.js'
export type { SearchBazaarOptions } from './bazaar.js'
export {
  discoverFromIdentity,
  loadRegistrationFile,
  x402Endpoints,
  probeOffers,
  IPFS_GATEWAY
} from './identity.js'
export type { RegistrationFile } from './identity.js'
export { serviceFromOffers } from './offers.js'
export type { OfferMetadata } from './offers.js'

export {
  getReputation,
  giveFeedback,
  submitPaidCallFeedback,
  buildFeedbackFile,
  encodeFeedbackFile,
  canonicalJson,
  resolveIndexerUrl,
  summaryToScore
} from './reputation.js'
export type {
  GiveFeedbackParams,
  GetReputationOptions,
  FeedbackPayment,
  FeedbackFile,
  ProofOfPayment,
  PaidCallFeedbackParams
} from './reputation.js'

export { PolicyVaultClient } from './policyvault.js'
export type {
  PolicyVaultOptions,
  PolicyParams,
  SpendAuthorization
} from './policyvault.js'

export {
  NETWORKS,
  DEFAULT_NETWORK,
  SUPPORTED_NETWORKS,
  isChainPeNetwork,
  parseNetwork,
  getNetworkConfig,
  networkFromCaip2,
  chainFor,
  explorerTxUrl,
  explorerAddressUrl,
  publicClientFor,
  findRegistryAddress,
  resolveRegistryAddress,
  resolveReputationRegistry,
  resolveIdentityRegistry,
  findPolicyVaultAddress,
  getUsdcAddress,
  getToken,
  findTokenByAddress,
  getX402Network,
  rpcUrlFor,
  normalizeKey,
  USDC_DECIMALS
} from './networks.js'
export type { NetworkConfig, Caip2Network, TokenConfig, TokenSymbol } from './networks.js'

export { ChainPePaymentError } from './types.js'
export type {
  ChainPeNetwork,
  ChainPeOptions,
  FetchOptions,
  ChainPeService,
  ServiceSource,
  DiscoverOptions,
  ReputationSummary,
  RankedService,
  PaymentInfo,
  PaidResult,
  Balances
} from './types.js'
