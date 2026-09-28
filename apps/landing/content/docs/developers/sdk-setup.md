---
id: sdk-setup
title: SDK Setup
sidebar_position: 2
---

# SDK Setup

Full documentation for initializing and configuring `@chainpe/sdk`.

## Installation

```bash
npm install @chainpe/sdk
```

## ChainPe constructor

```ts
import { ChainPe } from '@chainpe/sdk'

const cp = new ChainPe(options: ChainPeOptions)
```

### ChainPeOptions

```ts
interface ChainPeOptions {
  /** EOA private key (0x-prefixed or bare hex) used to sign payments + feedback. Required. */
  privateKey: string

  /**
   * Network. Defaults to 'arbitrum' (Arbitrum One mainnet).
   * Use 'arbitrum-sepolia' for testnet development. Unknown values throw.
   */
  network?: 'arbitrum' | 'arbitrum-sepolia'

  /** ChainPeRegistry address. Defaults to CHAINPE_REGISTRY_ADDRESS. Only needed for registry discovery. */
  registryAddress?: string

  /** ERC-8004 Reputation Registry address. Defaults to the canonical registry for the network. */
  reputationRegistry?: string

  /** @deprecated Unused — the provider's proxy picks the facilitator. */
  facilitatorUrl?: string

  /**
   * Max USDC to auto-pay for a single 402 (human units, e.g. "1.00").
   * The payment is refused if a 402 demands more. Defaults to "1".
   */
  maxPerCall?: string

  /**
   * When true, .fetch()/.pay() post positive ERC-8004 feedback after a successful
   * paid call. Defaults to false.
   */
  autoFeedback?: boolean

  /** ChainPe indexer URL for payment-verified reputation. Defaults to CHAINPE_INDEXER_URL. */
  indexerUrl?: string
}
```

### Example configurations

```ts
// Minimal (Arbitrum One mainnet, real USDC)
const cp = new ChainPe({ privateKey: process.env.KEY! })

// Arbitrum Sepolia testnet development
const cp = new ChainPe({
  privateKey: process.env.KEY!,
  network: 'arbitrum-sepolia',
  maxPerCall: '0.05'  // never pay more than 5 cents per call
})

// With auto-feedback (reputation accrues after every paid call)
const cp = new ChainPe({
  privateKey: process.env.KEY!,
  network: 'arbitrum',
  autoFeedback: true,
  maxPerCall: '0.10'
})

// Your registry + indexer
const cp = new ChainPe({
  privateKey: process.env.KEY!,
  network: 'arbitrum-sepolia',
  registryAddress: '0xYourRegistry',
  indexerUrl: 'https://your-indexer.example.com'
})
```

## ChainPe methods

### `cp.getAddress(): string`

Returns the wallet address derived from the private key. No RPC call.

```ts
console.log(cp.getAddress())  // '0xAbc123...'
```

### `cp.config`

Returns the resolved configuration (no secrets):

```ts
console.log(cp.config)
// {
//   network: 'arbitrum-sepolia',
//   address: '0xAbc...',
//   registryAddress: '0xYourRegistry' | undefined,
//   reputationRegistry: '0x8004B663...',
//   facilitatorUrl: undefined,
//   maxPerCall: '0.10'
// }
```

### `cp.balance(): Promise<Balances>`

Reads on-chain USDC and ETH balances:

```ts
interface Balances {
  usdc: string  // human units, e.g. "5.230000"
  eth: string   // native gas token, human units, e.g. "0.0012"
}

const { usdc, eth } = await cp.balance()
```

### `cp.fetch(url, opts?): Promise<Response>`

Drop-in fetch replacement. Returns the raw `Response` object. On a `402`, signs and retries automatically.

```ts
interface FetchOptions extends RequestInit {
  /** Override autoFeedback for this call */
  autoFeedback?: boolean
  /** Request timeout in ms. Default: 30000 */
  timeout?: number
}

const response = await cp.fetch('https://api.example.com/data')
const data = await response.json()
```

### `cp.pay<T>(url, opts?): Promise<PaidResult<T>>`

Like `fetch` but returns a structured result with payment metadata:

```ts
interface PaidResult<T> {
  status: number
  ok: boolean
  headers: Record<string, string>
  data: T                    // parsed JSON or text
  payment?: PaymentInfo      // present when a payment was made
  reputation?: {             // present when autoFeedback posted a rating
    agentId: string
    score: number
    txHash: string
  }
}

interface PaymentInfo {
  amount: string             // human units, e.g. "0.01"
  token: 'USDC' | 'USDT0'
  recipient: string          // provider's payTo address
  network: 'arbitrum' | 'arbitrum-sepolia'
  txHash?: string            // Arbitrum settlement tx
  settlement?: unknown       // raw decoded PAYMENT-RESPONSE
}

const result = await cp.pay<{ weather: string }>('https://api.example.com/weather')
console.log(result.data.weather)
console.log(result.payment?.txHash)
```

### `cp.discover(query?): Promise<RankedService[]>`

Discovers services from the ChainPe registry, Coinbase's x402 Bazaar and ERC-8004 registration files, de-duplicated by endpoint and ranked by reputation:

```ts
interface DiscoverOptions {
  query?: string       // free-text match over name/description/tags
  tags?: string[]      // filter by these tags
  maxPrice?: string    // max price in human USDC
  sources?: ('registry' | 'bazaar' | 'erc8004')[]   // default: all three
  agentIds?: string[]  // extra ERC-8004 agents to read
}

interface RankedService extends ChainPeService {
  reputation: ReputationSummary | null
}

// String shorthand
const services = await cp.discover('weather')

// Full options
const services = await cp.discover({
  query: 'weather',
  tags: ['api', 'data'],
  maxPrice: '0.05'
})
```

### `cp.getReputation(agentId): Promise<ReputationSummary | null>`

```ts
const rep = await cp.getReputation('42')
// { count: 15, score: 87.3, verified: true, unverifiedCount: 2 } or null
```

### `cp.giveFeedback(agentId, score, opts?): Promise<string>`

Posts ERC-8004 feedback (0–100). Returns the transaction hash. The wallet needs a little ETH for gas. Pass `payment` to attach a proof of payment so indexers count the review as verified.

```ts
const txHash = await cp.giveFeedback('42', 100, {
  endpoint: 'https://api.example.com',
  payment: { txHash: '0xSettlementTx', payTo: '0xProviderWallet' },
  waitConfirm: true
})
```

## Error handling

```ts
import { ChainPePaymentError } from '@chainpe/sdk'

try {
  const result = await cp.pay('https://api.example.com/data')
} catch (err) {
  if (err instanceof ChainPePaymentError) {
    console.error('Payment failed:', err.message)
    console.error('Reason:', err.reason)       // e.g. 'settlement_rejected'
    console.error('Tx hash:', err.txHash)     // if available
  }
}
```
