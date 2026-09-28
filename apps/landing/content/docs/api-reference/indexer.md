---
id: api-reference-indexer
title: Indexer API
sidebar_position: 3
---

# Indexer API

The indexer watches on-chain events from `ChainPeRegistry` and `ReputationRegistry`, caches them in Postgres, and serves O(1) REST queries.

**Base URL:** wherever you deploy `services/chainpe-indexer` (default port `4600`). Requests are rate-limited to 120 per minute per IP; CORS is open.

CORS is enabled for all origins.

---

## GET /health

Service liveness and sync status.

**Response:**
```json
{
  "status": "ok",
  "service": "chainpe-indexer",
  "network": "arbitrum-sepolia",
  "lastIndexedBlock": "12345678",
  "chainHead": "12345700"
}
```

`chainHead` is the latest block number the indexer knows about. A large gap between `lastIndexedBlock` and `chainHead` indicates the indexer is catching up.

**cURL:**
```bash
curl https://<your-indexer>/health
```

---

## GET /stats

Registry and feedback counts.

**Response:**
```json
{
  "services": 12,
  "feedback": 87,
  "network": "arbitrum-sepolia"
}
```

**cURL:**
```bash
curl https://<your-indexer>/stats
```

---

## GET /services

List all active services, filtered and ranked by ERC-8004 reputation.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `query` | string | Free-text search over name, description, and tags (case-insensitive) |
| `tag` | string | Filter by exact tag (case-insensitive) |
| `maxPrice` | string | Maximum price per request in USDC (e.g. `"0.05"`) |
| `offset` | number | Pagination offset (default: `0`) |
| `limit` | number | Page size (default: `100`, max: `100`) |

**Response:**
```json
{
  "total": 12,
  "offset": 0,
  "limit": 100,
  "items": [
    {
      "id": "0xDeveloperAddress:MyService",
      "key": "0xabc123...",
      "name": "My AI Research Agent",
      "description": "AI-powered research and summarization service",
      "tags": ["ai", "research", "summarization"],
      "endpoint": "https://api.example.com",
      "pricePerRequest": "0.01",
      "paymentToken": "USDC",
      "walletAddress": "0xProviderPayToAddress",
      "developer": "0xDeveloperAddress",
      "network": "arbitrum-sepolia",
      "agentId": "42",
      "reputation": {
        "count": 15,
        "score": 87.3,
        "unverifiedCount": 2
      }
    }
  ]
}
```

`reputation` is `null` for services with no linked `agentId`. `count` and `score` include only payment-verified reviews; `unverifiedCount` is the number of live reviews left out.

Results are sorted: services with a reputation score (highest first) → unscored services.

**cURL examples:**

```bash
# All services
curl https://<your-indexer>/services

# Filter by query
curl "https://<your-indexer>/services?query=weather"

# Filter by tag and price
curl "https://<your-indexer>/services?tag=ai&maxPrice=0.05"

# Paginate
curl "https://<your-indexer>/services?offset=10&limit=5"
```

---

## GET /services/:id

Get a single service by its key or `developer:name` identifier.

**Path parameter:**
- `:id` — either the raw `bytes32` storage key (0x-prefixed) or the `developer:name` string (e.g. `0xDeveloper:MyService`)

**Response:** same `ServiceDto` shape as a single item from `GET /services`

**Error (404):**
```json
{ "error": "service not found" }
```

**cURL:**
```bash
# By developer:name
curl "https://<your-indexer>/services/0xDeveloperAddress:My%20Research%20Agent"

# By storage key
curl "https://<your-indexer>/services/0xabc123..."
```

---

## GET /services/:id/reputation

Get the reputation summary for a specific service.

**Response:**
```json
{
  "network": "arbitrum-sepolia",
  "agentId": "42",
  "count": 15,
  "score": 87.3,
  "unverifiedCount": 2
}
```

For services with no `agentId`:
```json
{ "network": "arbitrum-sepolia", "agentId": null, "count": 0, "score": null, "unverifiedCount": 0 }
```

**Error (404):**
```json
{ "error": "service not found" }
```

**cURL:**
```bash
curl "https://<your-indexer>/services/0xDeveloperAddress:My%20Agent/reputation"
```

---

## GET /agents/:agentId/reputation

Verified reputation by ERC-8004 agent id. This is what the SDK reads when `CHAINPE_INDEXER_URL` / `indexerUrl` is set.

**Response:**
```json
{
  "network": "arbitrum-sepolia",
  "agentId": "42",
  "count": 15,
  "score": 87.3,
  "unverifiedCount": 2
}
```

Agents that aren't linked to a ChainPe service have no stored feedback and return `count: 0`. A non-numeric id returns `400 { "error": "invalid agent id" }`.

**cURL:**
```bash
curl https://<your-indexer>/agents/42/reputation
```

### What counts as verified

A review is verified when its feedback file hashes to the on-chain `feedbackHash`, carries a `proofOfPayment` matching the event's chain, agent and client, and that transaction moved an accepted stablecoin from the reviewer to the service's `payTo`. One payment backs at most one verified review. Only public `https://` and `ipfs://` feedback URIs are fetched (max 64 KB).

---

## ServiceDto schema

TypeScript interface for the response object:

```ts
interface ServiceDto {
  id: string           // 'developer:name'
  key: string          // bytes32 storage key (hex)
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string  // human USDC
  paymentToken: string     // 'USDC' | 'USDT0'
  walletAddress: string    // payTo address
  developer: string        // registrant address
  network: string          // 'arbitrum' | 'arbitrum-sepolia'
  agentId?: string         // ERC-8004 agent id
  reputation: {
    count: number            // distinct verified reviewers
    score: number | null
    unverifiedCount: number
  } | null
}
```
