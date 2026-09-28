# ChainPe Facilitator

A standalone, **non-custodial** x402 v2 facilitator for USDC payments on Arbitrum
One and Arbitrum Sepolia. It verifies payment authorizations and settles them
on-chain (paying the gas in ETH). One instance can serve several networks.

Most providers don't need it: the ChainPe proxy uses Coinbase CDP and PayAI by
default. Run your own when you want a facilitator you control, or as a fallback in
the proxy's `facilitators` list.

## Non-custodial by design

The facilitator key **only pays gas and relays the payer's already-signed
EIP-3009 `transferWithAuthorization`**. It never holds user funds and cannot move
money the payer did not authorize. Worst case if the key leaks: an attacker can
waste the gas balance — user funds are never at risk.

## Endpoints (x402 v2 facilitator)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness, facilitator address, networks; `degraded` when gas is low |
| GET | `/status` | ETH gas balance per network (reads the chain) |
| GET | `/supported` | Supported kinds: `exact` on `eip155:42161` / `eip155:421614` |
| GET | `/metrics` | Prometheus counters and gas gauges |
| POST | `/verify` | Verify a signed payment payload |
| POST | `/settle` | Submit the authorization on-chain (pays gas) |

`/verify` and `/settle` are rate-limited to 60 requests per minute per IP.

## Run locally

```bash
cp .env.example .env   # set FACILITATOR_PRIVATE_KEY (a funded gas wallet) and NETWORKS
npm install
npm run build
npm start              # listens on :4500
```

## Point a provider at it

```bash
chainpe start --facilitator-url http://localhost:4500
```

Or add it to `~/.chainpe/config.json`, alone or ahead of the hosted ones:

```json
{ "facilitators": [{ "kind": "url", "url": "https://your-facilitator.example.com" }, { "kind": "payai" }] }
```

## Deploy

See [DEPLOY.md](DEPLOY.md). The included `railway.json` builds and starts the
service with a `/health` check, and a `Dockerfile` is provided for other
platforms. Fund the facilitator address with ETH on every network it serves.

## Env

| Var | Default | Notes |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | — | required; gas-paying settlement key |
| `NETWORKS` | `arbitrum-sepolia` | comma-separated: `arbitrum`, `arbitrum-sepolia`. Unknown names stop the service. `NETWORK` is accepted as a fallback. |
| `ARBITRUM_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` | public RPCs | per-network RPC overrides |
| `RPC_URL` | — | RPC override when only one network is served |
| `ALLOWED_ORIGINS` | — | comma-separated CORS origins; empty blocks browser calls |
| `PORT` | `4500` | Railway injects this |
| `LOG_LEVEL` | `info` | pino log level |
