---
id: introduction
title: Introduction
description: ChainPe — x402 payments and ERC-8004 reputation for AI agents on Arbitrum
sidebar_position: 1
slug: /
---

# ChainPe

**ChainPe is payment + reputation infrastructure for the Arbitrum agent economy.**

Providers monetize any HTTP API (or AI agent) per request in USDC with one command. AI agents discover, pay for, and rate those services autonomously. A hosted x402 facilitator (Coinbase CDP or PayAI) settles each payment on **Arbitrum** and pays the gas, and every paid call can build portable **ERC-8004 reputation** on the canonical registries.

## The core insight

You build an AI agent and it needs to call a paid API. What do you do today? You hardcode an API key. You prepay a subscription. You hope it doesn't leak.

There is no way for the agent to pay per call autonomously — and no way for it to know which provider to trust. The missing layer is **payment + reputation rails built for machines**: pay-per-request, settled in the time of an HTTP round trip, with portable on-chain trust, and cheap enough that a $0.01 call is not eaten by fees.

ChainPe is that layer, on Arbitrum.

## Payments in three lines

```ts
import { ChainPe } from '@chainpe/sdk'

const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY!, network: 'arbitrum-sepolia' })
const res = await cp.fetch('https://api.example.com/paid')  // auto-pays a 402 in USDC
const data = await res.json()
```

`cp.fetch` is a drop-in `fetch` replacement. On a `402 Payment Required` response it signs a USDC payment (EIP-3009, x402 v2), retries, and returns the successful response. The agent never needs ETH — the facilitator pays gas.

## Key components

| Component | Description |
|---|---|
| **ChainPeRegistry** | On-chain registry of x402-gated services. Providers register; agents discover. Keyed by `keccak256(developer, name)`. |
| **ERC-8004 Reputation** | Portable agent identity + reputation on the canonical `0x8004…` registries. Feedback carries a proof of payment; the indexer counts only paying reviewers. |
| **x402 Bazaar** | Coinbase's public catalog of x402 resources. ChainPe providers list there, and ChainPe discovery searches it. |
| **PolicyVault** | Programmable, gasless spending policy. Owners set per-call caps, daily limits, and allowlists. The chain enforces every constraint. |
| **x402 Proxy** | The `@chainpe/cli` package starts a payment-gated reverse proxy in front of any backend. No code changes to the backend. |
| **Facilitators** | Coinbase CDP and PayAI verify and settle payments, with failover. ChainPe's own facilitator is a self-hosted option. |
| **Indexer** | Watches on-chain events → Postgres → O(1) REST discovery and payment-verified reputation. |

## ChainPe vs traditional approaches

| Feature | API Keys / Stripe | ChainPe |
|---|---|---|
| Agent can sign up autonomously | No — requires a human | Yes |
| Pay per single call | No — subscriptions only | Yes |
| Provider knows counterparty | No — anonymous | Yes — on-chain identity (ERC-8004) |
| Trust is portable across apps | No — locked to one platform | Yes — shared ERC-8004 registries |
| Agent spending capped on-chain | No | Yes — PolicyVault |
| Agent needs native gas token | — | No — the facilitator pays ETH gas |
| Settlement time | Days (card fraud windows) | One Arbitrum block (~250 ms) after submission |
| Settlement cost | 2–3% card fee | A fraction of a cent on Arbitrum |

## Who ChainPe is for

### Merchants (API sellers / providers)

You have an API, an LLM agent, or any HTTP service that produces value. You want to monetize it per call without API keys, subscriptions, or credit card integrations. You run `chainpe init && chainpe start` (and optionally `chainpe register`) and the x402 proxy gates each request. You receive USDC directly to your wallet — no intermediary holds funds.

### AI Agent Builders (buyers)

You build autonomous agents that call external services. You want those agents to pay for what they use, without hardwired API keys that can leak, and with a way to find trustworthy services ranked by real reputation. You install `@chainpe/sdk` or `@chainpe/ai-tools` and your agent can discover, pay, and rate services in the same loop.

### End Users / Operators

You deploy an agent on behalf of users and want fine-grained control over how much it can spend. You deploy a PolicyVault, deposit USDC, set per-call caps and daily limits, and grant the agent a session key. If the agent tries to exceed a limit, the contract rejects the transaction outright — not a backend check, the chain.

## Infrastructure, not a single app

ChainPe is infrastructure. Claude/MCP is just one client. The same payment + reputation core powers:

| Surface | Package | Description |
|---|---|---|
| SDK | `@chainpe/sdk` | Payments + discovery + reputation in 3 lines for any Node/TS project |
| Agent tools | `@chainpe/ai-tools` | Vercel AI SDK + LangChain tool adapters |
| CLI | `@chainpe/cli` | Provider proxy + consumer `fetch`/`discover` commands |
| Claude wallet | `chainpe-wallet-mcp` | MCP extension — Claude gets an Arbitrum x402 wallet |
| Agent SDK | `@chainpe/agent` | Standalone LLM agent loop that discovers and pays |
| Facilitator | `services/chainpe-facilitator` | Self-hosted, non-custodial x402 verify/settle |
| Indexer | `services/chainpe-indexer` | Events → Postgres → O(1) REST API |

## Networks

| | Arbitrum One | Arbitrum Sepolia |
|---|---|---|
| Chain ID / x402 network | `42161` / `eip155:42161` | `421614` / `eip155:421614` |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Explorer | [arbiscan.io](https://arbiscan.io) | [sepolia.arbiscan.io](https://sepolia.arbiscan.io) |

ChainPeRegistry and PolicyVault addresses are published in `docs/DEPLOYMENTS.md` in the repository once deployed.

## Next steps

- [Quickstart](./getting-started/quickstart.md) — make your first paid API call in minutes
- [Concepts](./concepts/overview.md) — understand x402, ERC-8004 and PolicyVault
- [SDK Reference](./sdk-reference/chainpe-sdk.md) — full API documentation
- [Smart Contracts](./smart-contracts/overview.md) — contract addresses and ABI reference
