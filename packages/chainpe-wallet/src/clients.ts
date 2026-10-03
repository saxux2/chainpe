import { erc20Abi, formatUnits, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { x402Client, x402HTTPClient } from '@x402/core/client'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import {
  getX402Network,
  getUsdcAddress,
  rpcUrlFor,
  publicClientFor,
  chainFor,
  explorerTxUrl,
  normalizeKey,
  USDC_DECIMALS
} from '@chainpe/sdk'
import type { PaymentNetwork, AppConfig } from '@/types.js'

// Network constants come from the SDK (single source of truth).
export {
  getX402Network,
  getUsdcAddress,
  rpcUrlFor,
  publicClientFor,
  chainFor,
  explorerTxUrl,
  USDC_DECIMALS
}

// ─── Signer / payment client ─────────────────────────────────────────────────

/**
 * Builds an x402 v2 HTTP payment client that signs USDC EIP-3009
 * authorizations for the configured network. Used by both the `pay` and
 * `x402_fetch` tools.
 */
export function buildPaymentClient(
  network: PaymentNetwork,
  config: AppConfig
): x402HTTPClient {
  if (!config.privateKey) {
    throw new Error(`No private key configured for network ${network}`)
  }
  const account = privateKeyToAccount(normalizeKey(config.privateKey))
  // Budgets are enforced by SpendingTracker, so disable x402's default $1 cap.
  const client = new x402Client()
    .register(getX402Network(network), new ExactEvmScheme(account))
    .setSpendControls(false)
  return new x402HTTPClient(client)
}

export function getWalletAddress(config: AppConfig): string {
  if (!config.privateKey) {
    throw new Error('No private key configured')
  }
  return privateKeyToAccount(normalizeKey(config.privateKey)).address
}

// ─── Balances ──────────────────────────────────────────────────────────────

export async function getUsdcBalance(
  network: PaymentNetwork,
  config: AppConfig
): Promise<string> {
  if (!config.privateKey) {
    throw new Error(`No key configured for network ${network}`)
  }
  try {
    const client = publicClientFor(network)
    const address = getAddress(getWalletAddress(config))
    const raw = (await client.readContract({
      address: getUsdcAddress(network),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address]
    })) as bigint
    return formatUnits(raw, USDC_DECIMALS)
  } catch {
    return '0.000000'
  }
}

/** Native ETH balance (gas token on Arbitrum). */
export async function getEthBalance(
  network: PaymentNetwork,
  address: string
): Promise<string> {
  try {
    const client = publicClientFor(network)
    const wei = await client.getBalance({ address: getAddress(address) })
    return formatUnits(wei, 18)
  } catch {
    return 'unavailable'
  }
}

/** Non-zero ERC-20 balances for the given tokens, keyed by symbol. */
export async function getTokenBalances(
  network: PaymentNetwork,
  address: string,
  tokens: { symbol: string; address: `0x${string}`; decimals: number }[]
): Promise<Record<string, string>> {
  const client = publicClientFor(network)
  const owner = getAddress(address)
  const entries = await Promise.all(
    tokens.map(async t => {
      try {
        const raw = (await client.readContract({
          address: t.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [owner]
        })) as bigint
        return raw > 0n
          ? ([t.symbol, formatUnits(raw, t.decimals)] as const)
          : null
      } catch {
        return null
      }
    })
  )
  return Object.fromEntries(entries.filter(e => e !== null))
}
