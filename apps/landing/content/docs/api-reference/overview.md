---
id: api-reference-overview
title: API Reference Overview
sidebar_position: 1
slug: /api-reference/overview
---

# API Reference

REST API reference for the two ChainPe backend services. Both are self-hosted: deploy them from `services/` (see [Services](../architecture/services.md)). Neither is required to make or receive payments — providers use Coinbase CDP / PayAI by default.

## Services

| Service | Default port | Networks |
|---|---|---|
| **[Facilitator](./facilitator.md)** | `4500` | Arbitrum One and/or Arbitrum Sepolia (`NETWORKS`) |
| **[Indexer](./indexer.md)** | `4600` | One network per instance (`NETWORK`) |

## Authentication

Neither service requires authentication for read endpoints. The facilitator's `/verify` and `/settle` endpoints accept any valid x402 payload — they are protected by rate limiting (60 req/min per IP) and the cryptographic validity of the signed USDC authorization.

## Rate limits

The facilitator allows **60 requests per minute per IP** on `/verify` and `/settle`; the indexer allows 120 per minute per IP on all routes. Exceeding a limit returns:

```json
HTTP 429
{ "error": "rate_limit_exceeded" }
```

## Error format

Indexer errors return JSON with an `error` field:

```json
{ "error": "description of the error" }
```

Facilitator errors follow the x402 response shapes (`{ "isValid": false, "invalidReason": … }` for verify, `{ "success": false, "errorReason": … }` for settle). Status codes: `400` for bad requests, `404` for not found, `429` for rate limit, `500` for internal errors.

## CORS

The facilitator blocks cross-origin browser requests by default. To allow specific origins, set `ALLOWED_ORIGINS` in the facilitator's environment. Server-to-server calls (no `Origin` header) always work.

The indexer enables CORS for all origins.
