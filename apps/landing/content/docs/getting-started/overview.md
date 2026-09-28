---
id: getting-started-overview
title: Getting Started
sidebar_position: 1
---

# Getting Started

Welcome to ChainPe. This section walks you from zero to a working paid API call on Arbitrum in a few minutes.

## What you will build

By the end of this section you will have:

1. Installed the `@chainpe/sdk` package
2. Created a `ChainPe` client with a wallet holding test USDC on Arbitrum Sepolia
3. Made a real USDC micropayment to an x402 API and received a response
4. Optionally put your own API behind an x402 proxy

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | The SDK uses native `fetch` and ES modules |
| A wallet with USDC | Arbitrum Sepolia for testing, Arbitrum One for real payments |
| A private key | The SDK signs EIP-3009 USDC authorizations client-side |

### Getting USDC

- **Testnet:** free Arbitrum Sepolia USDC from [faucet.circle.com](https://faucet.circle.com).
- **Mainnet:** native USDC on Arbitrum One (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`), withdrawn from an exchange that supports Arbitrum or moved with Circle CCTP.

The facilitator pays ETH gas when it settles your x402 payments, so **agents only need USDC**. You need a little ETH only to send your own transactions (registering a service, posting feedback, transfers).

## Sections

- [Installation](./installation.md) — install commands for all packages
- [Quickstart](./quickstart.md) — end-to-end: make a paid call in 5 minutes
- [First Payment](./first-payment.md) — detailed walkthrough of the USDC micropayment flow

## Choosing the right entry point

| Use case | Start here |
|---|---|
| Using a paid API from your own TypeScript/JavaScript code | [Quickstart](./quickstart.md) using `@chainpe/sdk` |
| Building a Vercel AI SDK agent that pays for services | [AI Tools](../developers/ai-tools.md) |
| Building a LangChain agent | [AI Tools](../developers/ai-tools.md) |
| Using Claude to pay for APIs via MCP | [Installation](./installation.md#claude-desktop-wallet-mcp) |
| Monetizing your own API | [Merchant Registration](../merchants/registration.md) |
| Running the services yourself | [Services](../architecture/services.md) |
