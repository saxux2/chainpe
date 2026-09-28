# Deploying the ChainPe facilitator (public URL)

The facilitator is a stateless HTTP service. Providers point their proxy at it with
`chainpe start --facilitator-url <url>` or a `{ "kind": "url" }` entry in
`facilitators`. It is **non-custodial** — its key only pays settlement gas and
relays the payer's signed authorization.

## Prerequisites

- A dedicated EOA as the **gas key** (`FACILITATOR_PRIVATE_KEY`). Do **not** reuse
  a key that holds user funds.
- Fund it with **ETH** on each network in `NETWORKS`. On Arbitrum Sepolia use any
  Sepolia ETH faucet and bridge, or an Arbitrum Sepolia faucet. A settlement costs
  a fraction of a cent on Arbitrum; `/health` reports `degraded` below 0.002 ETH.

## Deploy to Railway

`railway.json` (NIXPACKS build + `/health` healthcheck) and a `Dockerfile` are
included. Railway injects `PORT` automatically.

### Option A — Railway CLI

```bash
cd services/chainpe-facilitator
railway init                       # create/link a project
railway variables \
  --set FACILITATOR_PRIVATE_KEY=0x... \
  --set NETWORKS=arbitrum,arbitrum-sepolia
railway up                         # build + deploy
railway domain                     # mint a public https URL
```

### Option B — Dashboard

1. New Project → Deploy from GitHub repo → set **Root Directory** to
   `services/chainpe-facilitator`.
2. Variables: `FACILITATOR_PRIVATE_KEY`, `NETWORKS=arbitrum,arbitrum-sepolia`
   (optionally `ARBITRUM_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL`).
3. Networking → **Generate Domain**.

## Verify

```bash
curl https://<your-domain>/health      # { status: "ok", custodial: false, networks: [...] }
curl https://<your-domain>/supported   # exact on eip155:42161 / eip155:421614
curl https://<your-domain>/status      # gasBalanceEth + lowGas per network
```

Then point a provider at it:

```bash
chainpe start --facilitator-url https://<your-domain>
```

Record the URL in `docs/DEPLOYMENTS.md` once a real 402 has settled through it.

## Operating notes

- **Liveness:** `/health` is cheap (no RPC); Railway healthchecks hit it.
- **Gas monitoring:** poll `/status` or scrape `/metrics` — alert when `lowGas` is true.
- **Networks:** one instance serves every network in `NETWORKS` with the same key.
  Use separate instances (and keys) if you want to isolate mainnet from testnet.
- **RPC:** the public Arbitrum RPCs are rate-limited; use a provider RPC in production.
- **Security:** keep the key only in the platform's secret store; never commit it.
