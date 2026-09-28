/**
 * Network constants for Arbitrum One (mainnet) and Arbitrum Sepolia (testnet).
 *
 * This is the single source of truth for chain config across the ChainPe
 * packages (CLI, agent, wallet MCP, ai-tools) — they import from here rather
 * than keeping their own copies.
 *
 * ERC-8004 registries are the canonical singletons from erc-8004/erc-8004-contracts
 * (same vanity addresses on every chain). ChainPeRegistry and PolicyVault are
 * ChainPe's own deployments; until they are deployed on Arbitrum they must be
 * supplied via constructor arg or env.
 */
import { createPublicClient, http, getAddress, type Chain, type PublicClient } from 'viem'
import { arbitrum, arbitrumSepolia } from 'viem/chains'
import type { ChainPeNetwork } from './types.js'

export const USDC_DECIMALS = 6

/** CAIP-2 network id as used by x402 v2 (e.g. `eip155:42161`). */
export type Caip2Network = `eip155:${number}`

/** Stablecoins ChainPe can pay and be paid in. */
export type TokenSymbol = 'USDC' | 'USDT0'

export interface TokenConfig {
  symbol: TokenSymbol
  address: `0x${string}`
  decimals: number
  /** EIP-712 domain name / version the token signs authorizations with. */
  eip712Name: string
  eip712Version: string
  /**
   * How x402 moves the token: `eip3009` (native transferWithAuthorization,
   * gasless for the payer) or `permit2` (needs a one-time approval to Permit2).
   */
  transferMethod: 'eip3009' | 'permit2'
}

export interface NetworkConfig {
  /** ChainPe network id. */
  id: ChainPeNetwork
  /** Human-readable name. */
  name: string
  chain: Chain
  chainId: number
  /** x402 v2 network id. */
  caip2: Caip2Network
  testnet: boolean
  /** Default public RPC (rate-limited — override in production). */
  rpcUrl: string
  /** Env var that overrides {@link rpcUrl}. */
  rpcEnvVar: string
  /** Block explorer base URL (no trailing slash). */
  explorerUrl: string
  /** Native gas token symbol. */
  nativeSymbol: string
  /** Circle native USDC (6 decimals, EIP-3009). */
  usdc: `0x${string}`
  /** Tokens accepted on this network (USDC first). Payers refuse any other asset. */
  tokens: Partial<Record<TokenSymbol, TokenConfig>>
  /** Where to get test funds, when applicable. */
  faucetUrl?: string
  /** Canonical ERC-8004 Identity Registry. */
  identityRegistry: `0x${string}`
  /** Canonical ERC-8004 Reputation Registry. */
  reputationRegistry: `0x${string}`
  /** ChainPeRegistry deployment, once deployed on this network. */
  chainpeRegistry?: `0x${string}`
  /** PolicyVault deployment, once deployed on this network. */
  policyVault?: `0x${string}`
}

export const NETWORKS: Record<ChainPeNetwork, NetworkConfig> = {
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    chain: arbitrum,
    chainId: 42161,
    caip2: 'eip155:42161',
    testnet: false,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    rpcEnvVar: 'ARBITRUM_RPC_URL',
    explorerUrl: 'https://arbiscan.io',
    nativeSymbol: 'ETH',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokens: {
      USDC: {
        symbol: 'USDC',
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
        eip712Name: 'USD Coin',
        eip712Version: '2',
        transferMethod: 'eip3009'
      },
      // Tether USDT0 — EIP-3009 verified on-chain 2026-09-28 (typehash +
      // DOMAIN_SEPARATOR match name "USD₮0", version "1").
      USDT0: {
        symbol: 'USDT0',
        address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        decimals: 6,
        eip712Name: 'USD₮0',
        eip712Version: '1',
        transferMethod: 'eip3009'
      }
    },
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
  },
  'arbitrum-sepolia': {
    id: 'arbitrum-sepolia',
    name: 'Arbitrum Sepolia',
    chain: arbitrumSepolia,
    chainId: 421614,
    caip2: 'eip155:421614',
    testnet: true,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    rpcEnvVar: 'ARBITRUM_SEPOLIA_RPC_URL',
    explorerUrl: 'https://sepolia.arbiscan.io',
    nativeSymbol: 'ETH',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokens: {
      USDC: {
        symbol: 'USDC',
        address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
        decimals: 6,
        eip712Name: 'USD Coin',
        eip712Version: '2',
        transferMethod: 'eip3009'
      }
    },
    faucetUrl: 'https://faucet.circle.com',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713'
  }
}

export const DEFAULT_NETWORK: ChainPeNetwork = 'arbitrum'

export const SUPPORTED_NETWORKS = Object.keys(NETWORKS) as ChainPeNetwork[]

export function isChainPeNetwork(value: unknown): value is ChainPeNetwork {
  return typeof value === 'string' && value in NETWORKS
}

/**
 * Parses a user-supplied network name. Unknown values throw instead of
 * silently falling back to another chain.
 */
export function parseNetwork(
  value: string | undefined | null,
  fallback: ChainPeNetwork = DEFAULT_NETWORK
): ChainPeNetwork {
  if (value === undefined || value === null || value.trim() === '') return fallback
  const v = value.trim().toLowerCase()
  if (isChainPeNetwork(v)) return v
  throw new Error(
    `Unsupported network "${value}". Expected one of: ${SUPPORTED_NETWORKS.join(', ')}.`
  )
}

export function getNetworkConfig(network: ChainPeNetwork): NetworkConfig {
  return NETWORKS[network]
}

/** ChainPe network → x402 v2 CAIP-2 id. */
export function getX402Network(network: ChainPeNetwork): Caip2Network {
  return NETWORKS[network].caip2
}

/** x402 CAIP-2 id → ChainPe network, or undefined when not supported. */
export function networkFromCaip2(caip2: string): ChainPeNetwork | undefined {
  return SUPPORTED_NETWORKS.find(n => NETWORKS[n].caip2 === caip2)
}

/** RPC URL for a network: `ARBITRUM_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` → public default. */
export function rpcUrlFor(network: ChainPeNetwork): string {
  const cfg = NETWORKS[network]
  return process.env[cfg.rpcEnvVar] || cfg.rpcUrl
}

export function getUsdcAddress(network: ChainPeNetwork): `0x${string}` {
  return NETWORKS[network].usdc
}

/** Token config for a symbol on a network; throws when the network doesn't support it. */
export function getToken(network: ChainPeNetwork, symbol: TokenSymbol): TokenConfig {
  const token = NETWORKS[network].tokens[symbol]
  if (!token) {
    const available = Object.keys(NETWORKS[network].tokens).join(', ')
    throw new Error(`${symbol} is not supported on ${network} (available: ${available}).`)
  }
  return token
}

/** Finds an accepted token by contract address (case-insensitive), or undefined. */
export function findTokenByAddress(
  network: ChainPeNetwork,
  address: string
): TokenConfig | undefined {
  const a = address.toLowerCase()
  return Object.values(NETWORKS[network].tokens).find(t => t?.address.toLowerCase() === a)
}

export function chainFor(network: ChainPeNetwork): Chain {
  return NETWORKS[network].chain
}

export function explorerTxUrl(network: ChainPeNetwork, txHash: string): string {
  return `${NETWORKS[network].explorerUrl}/tx/${txHash}`
}

export function explorerAddressUrl(network: ChainPeNetwork, address: string): string {
  return `${NETWORKS[network].explorerUrl}/address/${address}`
}

export function publicClientFor(network: ChainPeNetwork, rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: NETWORKS[network].chain,
    transport: http(rpcUrl ?? rpcUrlFor(network))
  })
}

/**
 * Resolves the ChainPeRegistry address: explicit arg → env → built-in default.
 * Returns undefined when none is available.
 */
export function findRegistryAddress(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` | undefined {
  const candidate =
    explicit ?? process.env.CHAINPE_REGISTRY_ADDRESS ?? NETWORKS[network].chainpeRegistry
  return candidate ? getAddress(candidate) : undefined
}

/** Like {@link findRegistryAddress}, but throws when no address is available. */
export function resolveRegistryAddress(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` {
  const address = findRegistryAddress(network, explicit)
  if (!address) {
    throw new Error(
      `No ChainPe registry address for network "${network}". Pass registryAddress or set CHAINPE_REGISTRY_ADDRESS.`
    )
  }
  return address
}

/** Resolves the ERC-8004 Reputation Registry: explicit → env → canonical. */
export function resolveReputationRegistry(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` {
  return getAddress(
    explicit ?? process.env.ERC8004_REPUTATION_REGISTRY ?? NETWORKS[network].reputationRegistry
  )
}

/** Resolves the ERC-8004 Identity Registry: explicit → env → canonical. */
export function resolveIdentityRegistry(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` {
  return getAddress(
    explicit ?? process.env.ERC8004_IDENTITY_REGISTRY ?? NETWORKS[network].identityRegistry
  )
}

/** Resolves the PolicyVault address: explicit → env → built-in default. */
export function findPolicyVaultAddress(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` | undefined {
  const candidate = explicit ?? process.env.POLICY_VAULT_ADDRESS ?? NETWORKS[network].policyVault
  return candidate ? getAddress(candidate) : undefined
}

export function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}
