/**
 * ChainPe Agent SDK
 * Pre-built AI agent with x402 payment capabilities on Arbitrum.
 *
 * SECURITY: Wallet private keys are stored in the OS keychain, never in plaintext files.
 */

// Main Agent
export { ChainPeAgent, createAgent, type ChainPeAgentOptions } from "./agent.js";

// Types
export * from "./types.js";

// Configuration
export {
  loadConfig,
  saveConfig,
  configExists,
  buildConfig,
  getConfigPath,
  getDefaultRegistryPath,
  isValidPrivateKey,
  isValidAddress,
  addressFromPrivateKey,
  toChecksum,
  DEFAULT_MODELS,
  getDefaultModel,
  saveWalletToKeychain,
  getWalletPrivateKey,
  isWalletAvailable,
  type ConfigBuilder,
} from "./config.js";

// Keychain (Secure Credential Storage)
export {
  savePrivateKey,
  getPrivateKey,
  deletePrivateKey,
  hasPrivateKey,
  listStoredWallets,
  clearAllCredentials,
  isKeychainAvailable,
  getCredentialInfo,
} from "./keychain.js";

// Wallet
export {
  createWalletFromPrivateKey,
  createWalletFromAddress,
  createClient,
  getWalletBalance,
  hasSufficientUsdc,
  formatAmount,
  parseAmount,
  formatBalance,
  type WalletInstance,
  type WalletBalance,
} from "./wallet.js";

// Discovery (ChainPe registry, Coinbase Bazaar, ERC-8004 — via the SDK)
export {
  ServiceDiscovery,
  type AgentDiscoveryOptions,
  type DiscoveredService,
} from "./discovery.js";
export { RegistryClient } from "@chainpe/sdk";

// Payment
export { PaymentClient, createPaymentClient, type PaymentClientOptions } from "./payment.js";

// Reputation (ERC-8004) — re-exported from the SDK
export {
  getReputation,
  giveFeedback,
  submitPaidCallFeedback,
  resolveReputationRegistry,
  type ReputationSummary,
} from "@chainpe/sdk";

// Tools (for advanced users who want to customize the agent)
export {
  createDiscoverServiceTool,
  createCallPaidApiTool,
  createCallFreeApiTool,
  formatServiceForDisplay,
  type DiscoverServiceToolOptions,
  type CallPaidApiToolOptions,
} from "./tools/index.js";
