/**
 * ChainPe Agent SDK Types
 * Types for the consumer-side AI agent with x402 payment capabilities (Arbitrum)
 */

import {
  NETWORKS,
  SUPPORTED_NETWORKS,
  rpcUrlFor,
  type ChainPeNetwork,
  type ServiceSource,
  type TokenSymbol,
} from "@chainpe/sdk";

// ============================================================================
// LLM Configuration
// ============================================================================

export type LLMMode = "api" | "local";
export type LLMProvider = "openai" | "anthropic" | "gemini" | "groq";

export interface LLMConfig {
  mode?: LLMMode; // Defaults to "api" for backwards compatibility
  provider: LLMProvider;
  model: string;
  apiKey?: string; // Optional for local mode
  baseURL?: string; // Optional custom base URL (e.g., for Ollama)
}

// ============================================================================
// Network / Payment Configuration
// ============================================================================

export type { ChainPeNetwork };

// x402 "exact" on EVM settles in USDC.
export type PaymentToken = "USDC";

export interface WalletConfig {
  address: string; // EVM wallet address (0x), derived from the private key
  useKeychain?: boolean; // Whether the private key is stored in the OS keychain (default: true)
}

export interface PaymentConfig {
  preferredToken: PaymentToken;
  maxPricePerRequest?: string; // Max USDC per payment, e.g. "0.10" (default "10")
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
  llm: LLMConfig;
  wallet: WalletConfig;
  payment: PaymentConfig;
  registryPath?: string;
  network?: ChainPeNetwork;
  registryAddress?: string; // Deployed ChainPeRegistry contract address (0x)
  reputationRegistry?: string; // ERC-8004 Reputation Registry address (0x)
}

// ============================================================================
// Registry Types
// ============================================================================

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: TokenSymbol;
  walletAddress: string;
  network: ChainPeNetwork;
  source?: ServiceSource; // registry, Coinbase Bazaar or ERC-8004 registration file
  agentId?: string; // ERC-8004 agent identity
  createdAt?: string;
  updatedAt?: string;
}

export interface Registry {
  version: string;
  services: ServiceInfo[];
}

// ============================================================================
// Payment Types
// ============================================================================

export interface PaymentReceipt {
  txId?: string;
  amount: string;
  token: PaymentToken;
  recipient: string;
  timestamp: Date;
  service: string;
  path: string;
}

export interface PaymentSummary {
  totalSpent: Record<PaymentToken, string>;
  transactionCount: number;
  receipts: PaymentReceipt[];
}

// ============================================================================
// Task Types
// ============================================================================

export interface RunOptions {
  provider?: string; // Service name to use
  maxSteps?: number; // Max agentic loop iterations
  verbose?: boolean;
  onStep?: (step: StepInfo) => void;
  onPayment?: (receipt: PaymentReceipt) => void;
}

export interface StepInfo {
  stepNumber: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  text?: string;
  thinking?: string;
}

export interface TaskResult {
  text: string;
  success: boolean;
  steps: StepInfo[];
  payments: PaymentSummary;
  error?: string;
  duration: number;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultInfo {
  name: string;
  result: unknown;
}

// ============================================================================
// HTTP Client Types
// ============================================================================

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  paid?: boolean;
  paymentReceipt?: PaymentReceipt;
}

// ============================================================================
// Constants — Arbitrum (derived from the SDK's network table)
// ============================================================================

const byNetwork = <T>(pick: (n: ChainPeNetwork) => T): Record<ChainPeNetwork, T> =>
  Object.fromEntries(SUPPORTED_NETWORKS.map((n) => [n, pick(n)])) as Record<ChainPeNetwork, T>;

/** The agent defaults to testnet; pass `--network arbitrum` for mainnet. */
export const DEFAULT_AGENT_NETWORK: ChainPeNetwork = "arbitrum-sepolia";

export const CHAIN_IDS = byNetwork((n) => NETWORKS[n].chainId);

/** RPC URLs (honoring ARBITRUM_RPC_URL / ARBITRUM_SEPOLIA_RPC_URL). */
export const RPC_URLS = byNetwork((n) => rpcUrlFor(n));

// Canonical Circle USDC (6 decimals).
export const USDC_ADDRESS = byNetwork((n) => NETWORKS[n].usdc);

// x402 v2 network identifiers (CAIP-2).
export const X402_NETWORK = byNetwork((n) => NETWORKS[n].caip2);

export const EXPLORER = byNetwork((n) => NETWORKS[n].explorerUrl);

export const USDC_DECIMALS = 6;

export const DEFAULT_REGISTRY_PATH = "~/.chainpe/registry.json";
export const CONFIG_PATH = "~/.chainpe/agent.json";
