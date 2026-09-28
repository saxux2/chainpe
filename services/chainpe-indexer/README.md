# ChainPe indexer

Watches the **ChainPeRegistry** and the canonical **ERC-8004 Reputation Registry**
on Arbitrum into Postgres and serves an **O(1) discovery + reputation REST API** —
so clients and the dashboard don't have to paginate the registry or scan feedback
on-chain. It also decides which reviews count: only feedback that proves a payment
to the service is **verified**.

```
ChainPeRegistry ─┐                          ┌─ GET /services              (ranked by ⭐)
                 ├─ getLogs poll → Postgres ─┼─ GET /services/:id
ERC-8004 Rep ────┘                          ├─ GET /services/:id/reputation
                                            ├─ GET /agents/:agentId/reputation
                                            └─ GET /stats · /health
```

## How it works

- **Watcher** (`indexer.ts`): polls `getLogs` for `ServiceRegistered/Updated/
  Deregistered` and `NewFeedback/FeedbackRevoked`, in block-range chunks, advancing
  a cursor in `indexer_state` so restarts resume where they left off. Service rows
  are enriched with description + tags via a `getService` read (the events omit them).
  Feedback for agent ids not linked to a ChainPe service is skipped.
- **Verification** (`verify.ts`): fetches each review's feedback file (public
  `https://` or `ipfs://` via `IPFS_GATEWAY`, max 64 KB), checks its keccak256
  against the on-chain `feedbackHash`, and checks the `proofOfPayment` tx: a USDC
  (or other accepted token) transfer from the reviewer to the service's `payTo`,
  on the same chain, for the same agent. One payment backs at most one verified review.
- **Store** (`store.ts` + Drizzle/`schema.ts`): `services`, `feedback`,
  `indexer_state`. Schema is created idempotently on boot.
- **API** (`api.ts`): aggregates verified feedback into reputation
  (`aggregateReputation`) and ranks services (`rankServices`).

## Run locally

```bash
cp .env.example .env          # set DATABASE_URL, CHAINPE_REGISTRY_ADDRESS, START_BLOCK
npm install
npm run dev                   # watcher + API on :4600
curl localhost:4600/services  # ranked services with reputation
```

## Deploy (Railway)

```bash
cd services/chainpe-indexer
railway init
railway add --database postgres        # provisions DATABASE_URL
railway variables \
  --set NETWORK=arbitrum-sepolia \
  --set CHAINPE_REGISTRY_ADDRESS=<your registry> \
  --set START_BLOCK=<registry-deploy-block>
railway up
railway domain
```

## Env

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | required; Postgres |
| `NETWORK` | `arbitrum-sepolia` | or `arbitrum`; unknown values stop the service |
| `CHAINPE_REGISTRY_ADDRESS` | — | required; from `contracts/deployments/<network>.json` |
| `START_BLOCK` | — | **required**: the ChainPeRegistry deploy block. The Reputation Registry is shared by every ERC-8004 user, so indexing from genesis is never what you want. |
| `ERC8004_REPUTATION_REGISTRY` | canonical registry | override only for tests |
| `RPC_URL` | public Arbitrum RPC | use a provider RPC in production |
| `IPFS_GATEWAY` | `https://ipfs.io/ipfs` | for `ipfs://` feedback files |
| `POLL_INTERVAL_MS` | `5000` | |
| `LOG_CHUNK` | `10000` | max blocks per `getLogs` |
| `PORT` | `4600` | Railway injects this |

## API

| Endpoint | Returns |
|---|---|
| `GET /services?query=&tag=&maxPrice=` | active services + reputation, ranked best-first |
| `GET /services/:id` | one service (`:id` = `key` or `developer:name`) |
| `GET /services/:id/reputation` | `{ network, agentId, count, score, unverifiedCount }` |
| `GET /agents/:agentId/reputation` | same, by ERC-8004 agent id (what the SDK reads via `CHAINPE_INDEXER_URL`) |
| `GET /stats` | row counts |
| `GET /health` | liveness + `lastIndexedBlock` / `chainHead` |

`count` and `score` include verified reviews only; `unverifiedCount` is the number
left out for lacking a valid payment proof.

## Tests

`npm test` covers the pure core (event→row mapping, reputation aggregation,
ranking, payment-proof verification) — no DB required.
