---
id: architecture-services
title: Services Architecture
sidebar_position: 4
---

# Services Architecture

ChainPe ships two optional backend services: a self-hosted **facilitator** and the **indexer**. Providers don't need either — the proxy settles through hosted facilitators (Coinbase CDP, PayAI), and clients can read the chain and the x402 Bazaar directly. Both services include a `railway.json` and a `Dockerfile`.

## Facilitator

**Repository:** `services/chainpe-facilitator/`

### Responsibility

Implements the x402 v2 facilitator HTTP contract: `POST /verify` and `POST /settle`. Receives a signed USDC payment authorization from a provider proxy, verifies it, and submits it to the USDC contract on Arbitrum. One instance can serve Arbitrum One and Arbitrum Sepolia together. Use it as a fallback in a proxy's `facilitators` list, or when you want a facilitator you control.

### Non-custodial design

The facilitator holds only ETH for gas. It never holds user USDC. It can only move USDC that the payer already signed and authorized — if the key leaks, an attacker gains the gas balance but cannot steal payer funds.

### API surface

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Service info and endpoint list |
| `/health` | GET | Liveness; `status: "degraded"` when a network's gas balance is below 0.002 ETH |
| `/status` | GET | Live ETH gas balance per network |
| `/supported` | GET | Supported x402 kinds (`exact` on `eip155:42161` / `eip155:421614`) |
| `/metrics` | GET | Prometheus text-format counters and gas gauges |
| `/verify` | POST | Verify a payment payload (does not submit) |
| `/settle` | POST | Settle a payment on-chain |

### Configuration

| Env var | Required | Description |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | Yes | Gas-paying key; fund it with ETH on each network |
| `NETWORKS` | No | Comma-separated `arbitrum`, `arbitrum-sepolia` (default `arbitrum-sepolia`) |
| `ARBITRUM_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` | No | Per-network RPC overrides |
| `PORT` | No | HTTP port (Railway injects this) |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |

### Rate limiting

60 requests per minute per IP on `/verify` and `/settle`. Returns `{ error: "rate_limit_exceeded" }` on excess.

---

## Indexer

**Repository:** `services/chainpe-indexer/`

### Responsibility

Watches `ChainPeRegistry` and the canonical ERC-8004 `ReputationRegistry` on Arbitrum, verifies each review's proof of payment, stores results in Postgres, and serves a REST API for O(1) discovery and payment-verified reputation.

Without the indexer, clients read paginated contract state from an RPC node and can only get the raw, unverified reputation summary.

### Data model

- `services` — one row per active registered service (upserted on events)
- `feedback` — one row per ERC-8004 feedback event, with its verification verdict
- `indexer_state` — the last indexed block

### API surface

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service health + last indexed block |
| `/stats` | GET | Service and feedback counts |
| `/services` | GET | Filtered, ranked service list |
| `/services/:id` | GET | Single service by key or `developer:name` |
| `/services/:id/reputation` | GET | Verified reputation for a service |
| `/agents/:agentId/reputation` | GET | Verified reputation by ERC-8004 agent id |

Query parameters for `GET /services`:
- `query` — free-text search over name, description, tags
- `tag` — filter by exact tag
- `maxPrice` — maximum price per request in USDC
- `offset` — pagination offset (default 0)
- `limit` — page size (default and max 100)

### Configuration

| Env var | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `CHAINPE_REGISTRY_ADDRESS` | Yes | ChainPeRegistry contract address |
| `START_BLOCK` | Yes | ChainPeRegistry deploy block (the Reputation Registry is shared, so never index from genesis) |
| `NETWORK` | No | `arbitrum-sepolia` (default) or `arbitrum` |
| `ERC8004_REPUTATION_REGISTRY` | No | Override the canonical Reputation Registry |
| `RPC_URL` | No | RPC override |
| `IPFS_GATEWAY` | No | Gateway for `ipfs://` feedback files |
| `PORT` | No | HTTP port |

### Deployment

Connect the repo to Railway (or any container host), set the root directory to the service folder, and set the variables above. Railway provisions a public domain and health-checks `/health`.
