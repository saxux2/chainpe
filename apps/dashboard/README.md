# ChainPe dashboard

A Next.js marketing site for ChainPe on Arbitrum: the product pitch, install
snippet, FAQ and a waitlist form (`src/app/(marketing)`).

`/docs` redirects to the docs on the landing site (`apps/landing`, served from
`content/docs`). Set `NEXT_PUBLIC_DOCS_URL` to change the target (default
`https://chainpe.app/docs`).

## Run locally

```bash
cp .env.example .env        # optional
npm install
npm run dev                 # http://localhost:3000
```

## Env

| Var | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_NETWORK` | `arbitrum-sepolia` | or `arbitrum` |
| `NEXT_PUBLIC_CHAINPE_REGISTRY_ADDRESS` | — | ChainPeRegistry for the network |
| `NEXT_PUBLIC_ERC8004_REPUTATION_REGISTRY` | canonical registry | override only for tests |
| `INDEXER_URL` | — | ChainPe indexer, when deployed |
| `NEXT_PUBLIC_DOCS_URL` | `https://chainpe.app/docs` | where `/docs` redirects |

## Deploy

Standard Next.js app — deploy to Vercel (root directory `apps/dashboard`) or
Railway.

## Verify

```bash
npm run typecheck
npm run build
```
