/**
 * ChainPe Provider Types (Arbitrum)
 *
 * EVM-native types for the x402 payment gateway. Payment gating uses USDC via
 * the x402 "exact" scheme (EIP-3009 transferWithAuthorization). Prices are
 * expressed as human-readable USDC, e.g. "0.01".
 */

import type { ChainPeNetwork } from "./chains.js";
import type { TokenSymbol } from "@chainpe/sdk";

export type { ChainPeNetwork } from "./chains.js";

// ============================================================================
// Payment Token
// ============================================================================

// x402 "exact" settles in a stablecoin: USDC (both networks) or USDT0
// (Arbitrum One). ETH is used only for gas, paid by the facilitator.
export type PaymentToken = TokenSymbol;

// ============================================================================
// Provider Configuration
// ============================================================================

/** An x402 facilitator the provider proxy can use. */
export type FacilitatorSpec =
  | { kind: "cdp" } // Coinbase CDP — needs CDP_API_KEY_ID / CDP_API_KEY_SECRET
  | { kind: "payai" } // PayAI public facilitator
  | { kind: "url"; url: string }; // any x402 v2 facilitator, e.g. services/chainpe-facilitator

/** Bazaar discovery metadata declared on the provider's 402 offers. */
export interface DiscoveryConfig {
  enabled: boolean;
  /** JSON Schema of the request: query params for GET, the JSON body for POST. */
  inputSchema?: object;
  /** JSON Schema of the response. Only published together with `outputExample`. */
  outputSchema?: object;
  /** Example request input (query params or body). */
  inputExample?: Record<string, unknown>;
  /** Example response body. */
  outputExample?: unknown;
  /** How the endpoint is called. Default "GET". */
  method?: "GET" | "POST";
}

export interface ChainPeConfig {
  // Service identity
  serviceName: string;
  serviceDescription: string;
  tags: string[];

  // Backend target
  targetUrl: string;

  // Pricing
  pricePerRequest: string; // Human-readable USDC, e.g. "0.01"
  paymentToken: PaymentToken;

  // Wallet (0x address that receives payments)
  walletAddress: string;

  // Server
  proxyPort: number;

  // Network
  network: ChainPeNetwork;

  // Deployed ChainPeRegistry contract address (0x...)
  registryAddress?: string;

  // ERC-8004 agent identity for this service (persisted on register). When set,
  // the proxy advertises it on 402 responses so consumers can leave reputation
  // feedback without scanning the registry. Override via CHAINPE_AGENT_ID.
  agentId?: string;

  // Ordered x402 facilitators (verify + settle, pay gas). The first one that
  // supports the network is used; the next is tried if it is unreachable.
  // Default: CDP → PayAI on arbitrum (CDP only with API keys), PayAI on
  // arbitrum-sepolia. `chainpe start --facilitator <key>` settles in-process.
  facilitators?: FacilitatorSpec[];

  // Single facilitator URL (shorthand for `facilitators: [{ kind: "url", url }]`).
  facilitatorUrl?: string;

  // x402 Bazaar discovery. When enabled, every 402 offer declares the `bazaar`
  // extension; CDP lists the resource after its first paid settlement through
  // CDP. Default: enabled on arbitrum, disabled on arbitrum-sepolia.
  discovery?: DiscoveryConfig;

  // Optional settings
  logLevel?: "verbose" | "normal" | "quiet";
  adminKey?: string;
  rateLimit?: number;
}

// ============================================================================
// Registry Types
// ============================================================================

export interface ServiceRegistration {
  id: string; // "<developer>:<name>"
  name: string;
  description: string;
  tags: string[];
  endpoint: string; // Full URL to the x402-protected endpoint
  pricePerRequest: string;
  paymentToken: PaymentToken;
  walletAddress: string; // payTo (0x)
  developer: string; // 0x address that registered
  network: ChainPeNetwork;
  agentId?: string; // ERC-8004 agent identity (optional)
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Registry {
  version: string;
  services: ServiceRegistration[];
}

// ============================================================================
// Route Configuration
// ============================================================================

export interface RouteConfig {
  path: string;
  pricePerRequest: string; // Human-readable USDC
  paymentToken: PaymentToken;
  description?: string;
}

// ============================================================================
// Analytics
// ============================================================================

export interface RequestStats {
  totalRequests: number;
  paidRequests: number;
  failedPayments: number;
  totalRevenue: bigint; // atomic USDC (6 decimals)
  revenueByToken: Partial<Record<PaymentToken, bigint>>;
  requestsPerMinute: number[];
  lastHourRequests: number;
}

export interface PaymentEvent {
  timestamp: Date;
  path: string;
  amount: string;
  token: PaymentToken;
  payer: string;
  txId?: string;
  success: boolean;
  error?: string;
}

export interface ServerState {
  isRunning: boolean;
  startedAt?: Date;
  config: ChainPeConfig;
  stats: RequestStats;
  recentPayments: PaymentEvent[];
}

// ============================================================================
// CLI Types
// ============================================================================

export interface InitAnswers {
  targetUrl: string;
  serviceName: string;
  serviceDescription: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  tags: string;
  walletAddress: string;
  proxyPort: number;
}

// ============================================================================
// Utility Types
// ============================================================================

export type LogLevel = "verbose" | "normal" | "quiet";

export interface Logger {
  verbose: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  success: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}
