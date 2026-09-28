/**
 * Arbitrum network definitions for the CLI.
 *
 * A thin view over the SDK's network table (the single source of truth), in
 * the shape the CLI uses: chainId, RPC, USDC ERC-20 address, the x402 v2
 * (CAIP-2) network id, and the Arbiscan explorer base.
 */
import type { Chain } from "viem";
import {
  NETWORKS as SDK_NETWORKS,
  DEFAULT_NETWORK,
  SUPPORTED_NETWORKS,
  USDC_DECIMALS,
  isChainPeNetwork,
  parseNetwork,
  networkFromCaip2,
  rpcUrlFor,
  type ChainPeNetwork,
  type Caip2Network,
} from "@chainpe/sdk";

export type { ChainPeNetwork };
export { DEFAULT_NETWORK, SUPPORTED_NETWORKS, USDC_DECIMALS, isChainPeNetwork, parseNetwork };

export interface NetworkInfo {
  /** ChainPe-facing network name. */
  name: ChainPeNetwork;
  /** Human-readable name. */
  displayName: string;
  /** EVM chain id. */
  chainId: number;
  /** viem chain object. */
  chain: Chain;
  /** RPC URL (env override or public default). */
  rpcUrl: string;
  /** Canonical Circle USDC ERC-20 (6 decimals). */
  usdc: `0x${string}`;
  /** x402 v2 network identifier (CAIP-2). */
  x402Network: Caip2Network;
  /** Arbiscan explorer base URL (no trailing slash). */
  explorer: string;
  /** Native gas token symbol. */
  nativeSymbol: string;
  testnet: boolean;
  /** Canonical ERC-8004 Identity Registry. */
  identityRegistry: `0x${string}`;
}

export function getNetwork(network: ChainPeNetwork): NetworkInfo {
  const cfg = SDK_NETWORKS[network];
  if (!cfg) throw new Error(`Unknown network: ${network}`);
  return {
    name: cfg.id,
    displayName: cfg.name,
    chainId: cfg.chainId,
    chain: cfg.chain,
    rpcUrl: rpcUrlFor(network),
    usdc: cfg.usdc,
    x402Network: cfg.caip2,
    explorer: cfg.explorerUrl,
    nativeSymbol: cfg.nativeSymbol,
    testnet: cfg.testnet,
    identityRegistry: cfg.identityRegistry,
  };
}

/** Maps an x402 network id back to the ChainPe network name. */
export function fromX402Network(x402: string): ChainPeNetwork | undefined {
  return networkFromCaip2(x402);
}

export function explorerTxUrl(network: ChainPeNetwork, txHash: string): string {
  return `${getNetwork(network).explorer}/tx/${txHash}`;
}
