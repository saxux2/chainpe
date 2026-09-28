---
id: first-payment
title: First Payment Walkthrough
sidebar_position: 4
---

# First Payment Walkthrough

This page walks through exactly what happens when `cp.fetch()` or `cp.pay()` intercepts an HTTP 402 and settles a USDC micropayment on Arbitrum.

## The HTTP 402 Payment Required flow

HTTP status `402 Payment Required` has been reserved since HTTP/1.1 but was never standardized for general use. The x402 protocol (version 2) defines how to use it: a server returns `402` with a `PAYMENT-REQUIRED` header describing what payment it accepts, and the client attaches a `PAYMENT-SIGNATURE` header on the retry.

### Step-by-step

```
1. Client sends initial request
   GET /api/data HTTP/1.1

2. Server returns 402
   HTTP/1.1 402 Payment Required
   PAYMENT-REQUIRED: <base64 JSON>

   Decoded:
   {
     "x402Version": 2,
     "resource": { "url": "https://api.example.com/api/data", "description": "..." },
     "accepts": [{
       "scheme": "exact",
       "network": "eip155:421614",                                  // Arbitrum Sepolia
       "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",       // USDC
       "amount": "10000",                // 0.01 USDC in atomic units (6 decimals)
       "payTo": "0xAbc123...",           // provider wallet
       "maxTimeoutSeconds": 300,
       "extra": { "name": "USD Coin", "version": "2", "agentId": "42" }
     }]
   }

3. SDK signs an EIP-3009 authorization
   - Picks the offer on its own network in a token it accepts (USDC / USDT0)
   - Checks the amount does not exceed maxPerCall (constructor option)
   - Signs a USDC transferWithAuthorization with your private key:
       from: your wallet
       to: provider's payTo address
       value: 10000 (0.01 USDC)
       validAfter / validBefore: a window bounded by maxTimeoutSeconds
       nonce: random bytes32

4. SDK retries with the PAYMENT-SIGNATURE header
   GET /api/data HTTP/1.1
   PAYMENT-SIGNATURE: <base64 signed payload>

5. Provider proxy asks a facilitator to verify, then settle
   POST https://facilitator.payai.network/verify   (or Coinbase CDP, or your own)
   POST https://facilitator.payai.network/settle
   { "paymentPayload": { ... }, "paymentRequirements": { ... } }

6. Facilitator calls USDC.transferWithAuthorization on Arbitrum
   - Gas paid by the facilitator (not your wallet)
   - Included in the next Arbitrum block (~250 ms)
   - Returns: { success: true, transaction: "0xabc...", network: "eip155:421614" }

7. Provider returns 200 with PAYMENT-RESPONSE header
   HTTP/1.1 200 OK
   PAYMENT-RESPONSE: <base64 settlement receipt>

   { "data": "your response" }

8. SDK decodes PAYMENT-RESPONSE and returns PaidResult
   result.payment.txHash    = "0xabc..."
   result.payment.amount    = "0.01"
   result.payment.token     = "USDC"
   result.payment.recipient = "0xAbc123..."
```

## EIP-3009: why it works gaslessly

EIP-3009 (`transferWithAuthorization`) allows a token holder to pre-authorize a transfer by signing a structured message off-chain. A third party (the facilitator) can then call `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature)` on the USDC contract, which verifies the signature and executes the transfer in a single transaction.

This is why:
- The agent never submits an on-chain transaction
- The agent never needs ETH for gas
- The facilitator submits the transaction and pays gas
- The signed authorization can only transfer the exact amount to the exact recipient, once

## Code walkthrough

```ts
import { ChainPe } from '@chainpe/sdk'

// 1. Construct the client. This does NOT make any network requests.
const cp = new ChainPe({
  privateKey: '0xYOUR_PRIVATE_KEY',
  network: 'arbitrum-sepolia',
  maxPerCall: '0.05'  // refuse to pay more than 5 cents per call
})

// 2. Your wallet address (derived from the private key, no RPC call)
console.log('Paying from:', cp.getAddress())

// 3. Check balances (RPC reads)
const { usdc } = await cp.balance()
console.log('Balance:', usdc, 'USDC')

// 4. Make the paid call. This may or may not trigger a payment:
//    - If the endpoint returns 200 directly, no payment is made.
//    - If it returns 402, the SDK signs and retries.
const response = await cp.fetch('https://api.example.com/data')
console.log('Data:', await response.json())

// 5. For full payment metadata, use cp.pay() instead:
const result = await cp.pay('https://api.example.com/data')
if (result.payment) {
  console.log('Amount paid:', result.payment.amount, result.payment.token)
  console.log('To:', result.payment.recipient)
  console.log('Arbitrum tx:', result.payment.txHash)
}
```

## Verifying on Arbiscan

After a successful payment you will have a transaction hash. Open it on the explorer for your network:

```
https://sepolia.arbiscan.io/tx/0xYOUR_TX_HASH   # Arbitrum Sepolia
https://arbiscan.io/tx/0xYOUR_TX_HASH           # Arbitrum One
```

You should see:
- A `transferWithAuthorization` call on the USDC contract
- `From:` the facilitator's address (it paid the gas)
- A USDC `Transfer` from your wallet to the provider's `payTo` address

## What can go wrong

| Error | Cause | Fix |
|---|---|---|
| `x402: server accepts [eip155:42161] but wallet is on arbitrum-sepolia` | Network mismatch | Create the client with the endpoint's network |
| `x402: payment of ... exceeds maxPerCall` | The price exceeds your configured cap | Raise `maxPerCall` in the constructor |
| `x402: server asks for unsupported token(s)` | The endpoint wants a token ChainPe doesn't pay with | Only USDC (and USDT0 on Arbitrum One) are accepted |
| `x402: payment signed but the server could not settle` | Usually insufficient USDC | Top up USDC on that network and retry |
| `ChainPePaymentError: x402: failed to sign payment` | Invalid private key | Verify your key is 0x + 64 hex characters |

EIP-3009 needs no prior `approve()`, so you never need a USDC allowance to pay.

## Next steps

- [Concepts: x402 Protocol](../concepts/x402-protocol.md) — deeper dive into the payment protocol
- [SDK Reference](../sdk-reference/chainpe-sdk.md) — all `ChainPe` class methods
- [Payment Flows](../payment-flows/overview.md) — initiation, validation, settlement in detail
