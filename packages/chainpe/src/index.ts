/**
 * ChainPe - Provider SDK
 * Monetize any API with x402 micropayments on Arbitrum.
 */

// Types
export * from "./types.js";

// Networks
export {
  getNetwork,
  fromX402Network,
  explorerTxUrl,
  parseNetwork,
  isChainPeNetwork,
  DEFAULT_NETWORK,
  SUPPORTED_NETWORKS,
  USDC_DECIMALS,
} from "./chains.js";
export type { ChainPeNetwork, NetworkInfo } from "./chains.js";

// Proxy Server
export {
  createProxyServer,
  startProxyServer,
  analytics,
  Analytics,
  createRoutesConfig,
  formatRoutesForDisplay,
  DEFAULT_FACILITATOR_URL,
  createLocalFacilitator,
  resolveFacilitatorSpecs,
  buildFacilitator,
  hasCdpCredentials,
  FailoverFacilitatorClient,
  isRetryableFacilitatorError,
  isDiscoveryEnabled,
  createDiscoveryExtension,
  discoveryMetadataWarnings,
  describeBazaarListing,
  discoveryFromSchema,
} from "./proxy/index.js";
export type { RoutesConfig } from "./proxy/index.js";

// EVM helpers
export {
  createClient,
  isValidAddress,
  toChecksum,
  getAccountBalances,
  formatUsdc,
  formatEth,
  parseUsdc,
} from "./evm.js";
export type { AccountBalances } from "./evm.js";

// On-Chain Registry
export {
  ChainPeRegistryClient,
  onChainToServiceRegistration,
  resolveRegistryAddress,
  CHAINPE_REGISTRY_ABI,
} from "./registry.js";
export type { RegistrationResult, OnChainService } from "./registry.js";

// ERC-8004 identity
export {
  mintAgentIdentity,
  hasIdentity,
  resolveIdentityRegistry,
  IDENTITY_REGISTRY_ABI,
} from "./erc8004.js";
export type { MintResult } from "./erc8004.js";

// Browser / MetaMask registration handoff
export { registerViaBrowser } from "./wallet-connect-browser.js";
export type { BrowserRegisterParams, BrowserRegisterResult } from "./wallet-connect-browser.js";

// Logger
export { logger, setLogLevel, getLogLevel, logPayment, logRequest, logServerStart } from "./logger.js";
