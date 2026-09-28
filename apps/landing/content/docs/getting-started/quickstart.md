---
id: quickstart
title: Quickstart
sidebar_position: 2
---

# Quickstart

Make your first USDC micropayment to an x402 API on Arbitrum in under 5 minutes. This guide uses **Arbitrum Sepolia**, where USDC is free.

## Prerequisites

- Node.js 18+
- An EVM private key (0x-prefixed hex, 32 bytes). Use a fresh key for testing.
- Arbitrum Sepolia USDC from [faucet.circle.com](https://faucet.circle.com)

You do NOT need ETH in the agent wallet. The facilitator pays gas when it settles your payment.

## Step 1 — Install

```bash
npm install @chainpe/sdk
```

## Step 2 — Create a ChainPe client

```ts
import { ChainPe } from '@chainpe/sdk'

const cp = new ChainPe({
  privateKey: process.env.CHAINPE_PRIVATE_KEY!,
  network: 'arbitrum-sepolia',   // omit or use 'arbitrum' for Arbitrum One
  // Optional: per-call spending cap (default: 1 USDC)
  maxPerCall: '0.10',
  // Optional: auto-post ERC-8004 reputation after each paid call
  autoFeedback: false
})

console.log('Wallet address:', cp.getAddress())
```

## Step 3 — Check your balance

```ts
const balances = await cp.balance()
console.log(`USDC: ${balances.usdc}`)
console.log(`ETH:  ${balances.eth}`)
```

## Step 4 — Discover available services

```ts
const services = await cp.discover('weather')
for (const svc of services) {
  console.log(`${svc.name} — ${svc.pricePerRequest} ${svc.paymentToken} — ${svc.endpoint} [${svc.source}]`)
  if (svc.reputation) {
    const tag = svc.reputation.verified ? 'verified' : 'unverified'
    console.log(`  Reputation: ${svc.reputation.score} (${svc.reputation.count} ratings, ${tag})`)
  }
}
```

`discover()` searches the ChainPe registry (when `CHAINPE_REGISTRY_ADDRESS` is set), Coinbase's x402 Bazaar and ERC-8004 registration files, and ranks results by reputation.

## Step 5 — Make a paid API call

```ts
// cp.fetch() is a drop-in fetch() replacement.
// It intercepts HTTP 402, signs a USDC payment, and retries automatically.
const response = await cp.fetch('https://api.example.com/data')
const data = await response.json()
console.log(data)
```

If the endpoint returns `402 Payment Required`, the SDK will:
1. Read the x402 v2 payment requirements from the `PAYMENT-REQUIRED` header
2. Check the network, token and price against your client (`maxPerCall`)
3. Sign a USDC `transferWithAuthorization` (EIP-3009) with your private key
4. Retry with the `PAYMENT-SIGNATURE` header and return the successful response

## Step 6 — Use `pay()` for structured results

`cp.pay()` is like `cp.fetch()` but returns a structured object including payment details:

```ts
const result = await cp.pay<{ answer: string }>('https://api.example.com/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'What is the capital of France?' })
})

console.log('Status:', result.status)
console.log('Answer:', result.data.answer)

if (result.payment) {
  console.log('Paid:', result.payment.amount, result.payment.token)
  console.log('Recipient:', result.payment.recipient)
  console.log('Tx:', `https://sepolia.arbiscan.io/tx/${result.payment.txHash}`)
}
```

## Step 7 — Monetize your own API (optional)

```bash
npm install -g @chainpe/cli
chainpe init      # interactive wizard → saves to ~/.chainpe/config.json
chainpe start     # starts the x402 payment proxy
chainpe register  # optional: publish the service on-chain
```

See [Merchant Registration](../merchants/registration.md) for a full walkthrough.

## Complete working example

```ts
import { ChainPe } from '@chainpe/sdk'

async function main() {
  const cp = new ChainPe({
    privateKey: process.env.CHAINPE_PRIVATE_KEY!,
    network: 'arbitrum-sepolia',
    maxPerCall: '0.10'
  })

  const { usdc } = await cp.balance()
  console.log(`Balance: ${usdc} USDC`)

  const services = await cp.discover({ query: 'weather', maxPrice: '0.05' })
  console.log(`Found ${services.length} services under 0.05 USDC/call`)
  if (services.length === 0) return

  const target = services[0]
  console.log(`Calling: ${target.name} at ${target.endpoint}`)

  const result = await cp.pay(target.endpoint)
  console.log('Response:', result.data)
  console.log('Payment:', result.payment)
}

main().catch(console.error)
```

## Expected output

```
Balance: 20.000000 USDC
Found 2 services under 0.05 USDC/call
Calling: Weather Oracle at https://weather.example.com
Response: { temperature: 22, unit: "C", location: "San Francisco" }
Payment: { amount: "0.01", token: "USDC", recipient: "0xAbc...", network: "arbitrum-sepolia", txHash: "0x123..." }
```

## Troubleshooting

**`x402: server accepts [eip155:42161] but wallet is on arbitrum-sepolia (eip155:421614).`**
The endpoint charges on a different network. Create the client with the matching `network`.

**`x402: payment of X USDC exceeds maxPerCall ...`**
The endpoint costs more than your cap. Raise `maxPerCall` if that's intended.

**`x402: server asks for unsupported token(s) [...]`**
The endpoint wants a token ChainPe doesn't pay with. Payers accept USDC (both networks) and USDT0 (Arbitrum One) only.

**`ChainPePaymentError: x402: failed to sign payment`**
Check that `CHAINPE_PRIVATE_KEY` is a valid 0x-prefixed 64-hex-character private key.

**`x402: payment signed but the server could not settle`**
Usually not enough USDC on the wallet for that network. Top up from the faucet (testnet) and retry.
