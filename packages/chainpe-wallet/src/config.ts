import { parseNetwork } from '@chainpe/sdk'
import type { AppConfig } from '@/types.js'
import { loadWalletConfig } from '@/wallet-store.js'

export function loadConfig(): AppConfig {
  const state = buildState()
  return {
    ...state,
    reload() {
      const fresh = buildState()
      Object.assign(this, fresh)
    }
  }
}

function buildState(): Omit<AppConfig, 'reload'> {
  const wallet = loadWalletConfig()

  const privateKey =
    process.env.CHAINPE_PRIVATE_KEY ?? wallet?.privateKey ?? undefined
  // Defaults to testnet. Unknown values (e.g. a legacy "fuji" wallet file)
  // throw instead of silently falling back to another chain.
  const network = parseNetwork(process.env.NETWORK ?? wallet?.network, 'arbitrum-sepolia')
  const registryAddress =
    process.env.CHAINPE_REGISTRY_ADDRESS ?? wallet?.registryAddress ?? undefined
  const reputationRegistry =
    process.env.ERC8004_REPUTATION_REGISTRY ??
    wallet?.reputationRegistry ??
    undefined

  const maxPerCall = process.env.MAX_PER_CALL ?? '0.10'
  const maxPerDay = process.env.MAX_PER_DAY ?? '20.00'

  const canPay = !!privateKey

  return {
    privateKey,
    network,
    registryAddress,
    reputationRegistry,
    budget: { maxPerCall, maxPerDay },
    canPay,
    mode: canPay ? 'ARBITRUM' : 'READ_ONLY'
  }
}
