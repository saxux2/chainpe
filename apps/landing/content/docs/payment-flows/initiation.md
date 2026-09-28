---
id: payment-initiation
title: Payment Initiation
sidebar_position: 2
---

# Payment Initiation

The initiation phase covers everything from the agent's first request to the moment it signs the USDC authorization.

## Initial request

The agent sends a standard HTTP request with no payment header:

```http
GET /api/data HTTP/1.1
Host: api.example.com
Accept: application/json
```

## Server response: 402

The x402-protected endpoint returns `402 Payment Required` with a base64-encoded `PAYMENT-REQUIRED` header. Decoded:

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/api/data", "description": "Weather data, per query" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:421614",
      "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      "amount": "10000",
      "payTo": "0xProviderWalletAddress",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2", "agentId": "42" }
    }
  ]
}
```

ChainPe's proxy also sets the `X-CHAINPE-AGENT-ID` response header with the provider's ERC-8004 agent id, so the payer can post reputation feedback without a registry scan.

## Offer selection

The SDK keeps only `exact` offers on its configured network (CAIP-2 id), then picks the first one whose `asset` is a token in the SDK's network table:

```ts
const onNetwork = paymentRequired.accepts.filter(
  a => a.network === getX402Network(this.network) && a.scheme === 'exact'
)
const accept = onNetwork.find(a => findTokenByAddress(this.network, a.asset))
```

If no offer is on its network, or none is in an accepted token, the SDK throws with the offending networks or assets listed.

## maxPerCall guard

Before signing, the SDK checks the price against the configured `maxPerCall`:

```ts
const required = BigInt(accept.amount)
if (required > cap) {
  throw new Error(`x402: payment of ${formatUnits(required, token.decimals)} ${token.symbol} exceeds maxPerCall ...`)
}
```

This prevents unexpected spend if a service raises its price without the agent's knowledge.

## Signing the EIP-3009 authorization

The SDK builds the payment with the x402 v2 client (`@x402/core` + `@x402/evm`). It signs an EIP-712 `TransferWithAuthorization` message against the token's domain (`extra.name` / `extra.version`):

```ts
{
  from: agentWallet,        // who authorizes the transfer
  to: accept.payTo,         // provider's wallet
  value: accept.amount,     // exact amount
  validAfter,               // start of the validity window
  validBefore,              // bounded by maxTimeoutSeconds
  nonce: randomBytes32()    // single-use
}
```

The private key never leaves the agent's process. The signature authorizes exactly this amount to exactly this recipient — the facilitator cannot redirect funds.

## The PAYMENT-SIGNATURE header

The signed payload is base64-encoded into the `PAYMENT-SIGNATURE` request header:

```http
GET /api/data HTTP/1.1
Host: api.example.com
PAYMENT-SIGNATURE: <base64-encoded x402 v2 payment payload>
```

The SDK then retries the original request with this header attached.

## Timeout behavior

Each request has a configurable timeout (default: 30 seconds). The SDK wraps each `fetch` call with an `AbortController`. Pass `timeout` in `FetchOptions` to override per request.
