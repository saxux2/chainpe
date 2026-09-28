---
id: merchants-overview
title: Merchant Overview
sidebar_position: 1
---

# For Merchants (API Sellers)

ChainPe lets you monetize any HTTP API per-call in USDC without API keys, subscriptions, or credit card integrations. Your backend receives no code changes — the x402 proxy sits in front and handles all payment gating.

## How it works

```
Client request
    │
    ▼
┌─────────────────────────────┐
│ ChainPe x402 Proxy           │  ← chainpe start
│  (Express + @x402/express)   │
│  port 4402 (default)         │
└──────────┬──────────────────┘
           │ payment verified
           ▼
┌─────────────────────────────┐
│ Your backend                │  ← http://localhost:3000
│  (any HTTP server)          │
└─────────────────────────────┘
```

The proxy:
1. Returns `402 Payment Required` with an x402 v2 offer (price, your `payTo`, USDC, network)
2. Waits for a `PAYMENT-SIGNATURE` header with a signed USDC authorization
3. Has a facilitator (Coinbase CDP or PayAI, with failover) verify it
4. Forwards the request to your backend
5. Has the facilitator settle on Arbitrum, then returns the response to the client

## Quick start for merchants

```bash
# Install
npm install -g @chainpe/cli

# Interactive setup
chainpe init

# Start the proxy
chainpe start

# Register on-chain (makes your service discoverable)
chainpe register
```

## Sections in this guide

- [Registration](./registration.md) — how to register your service on ChainPeRegistry
- [Policy Configuration](./policy-configuration.md) — set up PolicyVault for buyers
- [Receiving Payments](./receiving-payments.md) — USDC settlement and earnings
