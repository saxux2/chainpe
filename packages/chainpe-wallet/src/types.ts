import type { ChainPeNetwork } from '@chainpe/sdk'

/** Arbitrum One (`arbitrum`) or Arbitrum Sepolia (`arbitrum-sepolia`). */
export type PaymentNetwork = ChainPeNetwork

export interface AppConfig {
  privateKey?: string
  network: PaymentNetwork
  registryAddress?: string
  reputationRegistry?: string
  budget: BudgetConfig
  /** Per-swap cap on the input value, in USD. */
  maxSwapUsd: string
  canPay: boolean
  mode: 'READ_ONLY' | 'ARBITRUM'
  reload(): void
}

export interface BudgetConfig {
  maxPerCall: string
  maxPerDay: string
}

export interface WalletFileConfig {
  privateKey?: string
  network?: string
  registryAddress?: string
  reputationRegistry?: string
  createdAt?: string
}

export interface SpendingRecord {
  recipient: string
  amount: string
  network: string
  timestamp: string
}
