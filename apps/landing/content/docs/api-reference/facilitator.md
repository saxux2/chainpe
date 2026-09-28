---
id: api-reference-facilitator
title: Facilitator API
sidebar_position: 2
---

# Facilitator API

`services/chainpe-facilitator` is a self-hostable, non-custodial x402 v2 facilitator for Arbitrum One and Arbitrum Sepolia. It implements the facilitator HTTP contract that `@x402/core`'s `HTTPFacilitatorClient` speaks, so the ChainPe proxy — or any x402 v2 resource server — can use it alongside Coinbase CDP and PayAI.

**Base URL:** wherever you deploy it (default port `4500`). ChainPe does not run a public instance; providers use CDP / PayAI by default.

## GET /

Service info.

```json
{
  "service": "chainpe-facilitator",
  "description": "Non-custodial x402 verify + settle for USDC on Arbitrum.",
  "networks": ["arbitrum", "arbitrum-sepolia"],
  "custodial": false,
  "endpoints": ["/health", "/status", "/supported", "/metrics", "/verify", "/settle"]
}
```

## GET /health

Liveness check (no RPC call). Always HTTP 200 while the process runs; `status` is `"degraded"` when a network's cached gas balance is below 0.002 ETH.

```json
{
  "status": "ok",
  "service": "chainpe-facilitator",
  "networks": ["arbitrum", "arbitrum-sepolia"],
  "x402Networks": ["eip155:42161", "eip155:421614"],
  "facilitator": "0xFacilitatorAddress",
  "custodial": false
}
```

When degraded, the body adds `"warning": "low_gas"` and `"lowGasNetworks": [...]`.

```bash
curl https://<your-facilitator>/health
```

## GET /status

Reads the live ETH balance of the gas key on each network.

```json
{
  "service": "chainpe-facilitator",
  "facilitator": "0xFacilitatorAddress",
  "networks": [
    { "network": "arbitrum", "x402Network": "eip155:42161", "gasBalanceEth": "0.0213", "lowGas": false },
    { "network": "arbitrum-sepolia", "x402Network": "eip155:421614", "gasBalanceEth": "0.5", "lowGas": false }
  ]
}
```

## GET /supported

The x402 kinds this instance can settle (from `@x402/core`'s `getSupported()`).

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "eip155:42161" },
    { "x402Version": 2, "scheme": "exact", "network": "eip155:421614" }
  ],
  "extensions": [],
  "signers": { "eip155:*": ["0xFacilitatorAddress"] }
}
```

## GET /metrics

Prometheus text format:

```
# HELP chainpe_verify_total Total /verify requests handled
# TYPE chainpe_verify_total counter
chainpe_verify_total{result="success"} 120
chainpe_verify_total{result="error"} 2
# HELP chainpe_settle_total Total /settle requests handled
# TYPE chainpe_settle_total counter
chainpe_settle_total{result="success"} 118
chainpe_settle_total{result="error"} 1
# HELP chainpe_gas_balance_eth Current gas key ETH balance per network
# TYPE chainpe_gas_balance_eth gauge
chainpe_gas_balance_eth{network="arbitrum",facilitator="0x…"} 0.0213
```

Counters reset on restart.

## POST /verify

Verify a signed payment without submitting it. Rate-limited to 60 requests/minute per IP.

**Request:**

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "exact",
      "network": "eip155:421614",
      "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      "amount": "10000",
      "payTo": "0xProviderWallet",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    },
    "payload": {
      "signature": "0x…",
      "authorization": {
        "from": "0xAgentWallet",
        "to": "0xProviderWallet",
        "value": "10000",
        "validAfter": "1790000000",
        "validBefore": "1790000300",
        "nonce": "0x…"
      }
    }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "eip155:421614",
    "asset": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    "amount": "10000",
    "payTo": "0xProviderWallet",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USD Coin", "version": "2" }
  }
}
```

**Response (200):**

```json
{ "isValid": true, "payer": "0xAgentWallet" }
```

A malformed request or an unsupported network returns HTTP 400 with `{ "isValid": false, "invalidReason": "verify_failed" }`.

```bash
curl -X POST https://<your-facilitator>/verify \
  -H "Content-Type: application/json" \
  -d @payment.json
```

## POST /settle

Verify and settle on Arbitrum by submitting `USDC.transferWithAuthorization`. The facilitator pays the ETH gas. Same request body as `/verify`.

**Response (200):**

```json
{
  "success": true,
  "transaction": "0xabc123…",
  "network": "eip155:421614",
  "payer": "0xAgentWallet"
}
```

**Failure (400):**

```json
{
  "success": false,
  "errorReason": "settle_failed",
  "transaction": "",
  "network": "eip155:421614"
}
```

```bash
curl -X POST https://<your-facilitator>/settle \
  -H "Content-Type: application/json" \
  -d @payment.json
```
