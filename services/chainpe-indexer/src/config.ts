import 'dotenv/config'
import { getAddress, type Chain } from 'viem'
import { arbitrum, arbitrumSepolia } from 'viem/chains'

export type Network = 'arbitrum' | 'arbitrum-sepolia'

interface NetworkDef {
  chain: Chain
  defaultRpc: string
  /** ChainPeRegistry deployment, once deployed on this network. */
  registry?: string
  /** Canonical ERC-8004 Reputation Registry (erc-8004/erc-8004-contracts). */
  reputation: string
  /** Stablecoins a payment proof may point at (mirrors the SDK's token table). */
  tokens: string[]
}

const NETWORK_DEFS: Record<Network, NetworkDef> = {
  arbitrum: {
    chain: arbitrum,
    defaultRpc: 'https://arb1.arbitrum.io/rpc',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    tokens: [
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
      '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' // USDT0
    ]
  },
  'arbitrum-sepolia': {
    chain: arbitrumSepolia,
    defaultRpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    tokens: ['0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'] // USDC
  }
}

/** Parses NETWORK. Unknown values are fatal — never silently index another chain. */
export function parseNetwork(raw: string | undefined): Network {
  const v = (raw ?? 'arbitrum-sepolia').trim().toLowerCase()
  if (v in NETWORK_DEFS) return v as Network
  throw new Error(
    `Unsupported NETWORK "${raw}". Expected one of: ${Object.keys(NETWORK_DEFS).join(', ')}.`
  )
}

export const NETWORK: Network = parseNetwork(process.env.NETWORK)
export const CHAIN: Chain = NETWORK_DEFS[NETWORK].chain

export const PAYMENT_TOKENS: `0x${string}`[] = NETWORK_DEFS[NETWORK].tokens.map(t => getAddress(t))

/** Gateway for `ipfs://` feedback files. */
export const IPFS_GATEWAY = (process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs').replace(/\/+$/, '')

export const RPC_URL = process.env.RPC_URL || NETWORK_DEFS[NETWORK].defaultRpc

function resolve(envValue: string | undefined, fallback: string | undefined, label: string): `0x${string}` {
  const candidate = envValue || fallback
  if (!candidate) throw new Error(`${label} address not set for network "${NETWORK}".`)
  return getAddress(candidate)
}

export const REGISTRY_ADDRESS = resolve(
  process.env.CHAINPE_REGISTRY_ADDRESS,
  NETWORK_DEFS[NETWORK].registry,
  'ChainPeRegistry (set CHAINPE_REGISTRY_ADDRESS)'
)
export const REPUTATION_ADDRESS = resolve(
  process.env.ERC8004_REPUTATION_REGISTRY,
  NETWORK_DEFS[NETWORK].reputation,
  'ERC-8004 Reputation Registry'
)

/** Postgres connection string — required at runtime (not for typecheck/tests). */
export const DATABASE_URL = process.env.DATABASE_URL ?? ''

export const PORT = Number(process.env.PORT ?? 4600)

/**
 * First block to index. Required: Arbitrum has hundreds of millions of blocks
 * and the canonical Reputation Registry is shared, so replaying from genesis
 * is never what you want. Use the ChainPeRegistry deployment block.
 */
function parseStartBlock(raw: string | undefined): bigint {
  if (!raw) {
    throw new Error(
      'START_BLOCK is required on Arbitrum — set it to the ChainPeRegistry deployment block.'
    )
  }
  return BigInt(raw)
}
export const START_BLOCK = parseStartBlock(process.env.START_BLOCK)

export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000)
/** Max block span per getLogs request (public RPCs cap this; Arbitrum blocks are ~250 ms). */
export const LOG_CHUNK = BigInt(process.env.LOG_CHUNK ?? '10000')
