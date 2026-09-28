# Changelog

All notable changes to ChainPe are documented here.

## [Unreleased] — Arbitrum migration (2026-09)

ChainPe moves from Avalanche C-Chain to **Arbitrum One** (mainnet) and **Arbitrum
Sepolia** (testnet). Avalanche and Fuji support is removed; the Avalanche contracts
are archived (see `docs/DEPLOYMENTS.md`).

### Changed
- **Networks:** every package runs on `arbitrum` and `arbitrum-sepolia`. Unknown
  network names throw instead of falling back to another chain. The SDK's
  `networks.ts` is the single chain table for the CLI, wallet, agent and ai-tools.
- **x402 v2:** all packages use `@x402/core`, `@x402/evm`, `@x402/express` and
  `@x402/fetch` (CAIP-2 networks such as `eip155:42161`, `PAYMENT-SIGNATURE` /
  `PAYMENT-RESPONSE` headers).
- **ERC-8004:** clients use the canonical Identity and Reputation registries
  (`0x8004…`) instead of self-deployed copies. Feedback carries a spec-shaped
  feedback file with an optional proof of payment.
- **Facilitators:** the provider proxy defaults to Coinbase CDP (with API keys) and
  PayAI, with failover between them; `--facilitator-url` overrides the list.
  `services/chainpe-facilitator` serves several networks (`NETWORKS=…`).
- **Discovery:** `discover()` merges the ChainPe registry, Coinbase's x402 Bazaar
  and ERC-8004 registration files. Providers can list in the Bazaar.
- **Reputation:** the indexer counts only reviews that prove a payment
  (`verified`); the SDK reads it from `CHAINPE_INDEXER_URL`.
- **Tokens:** USDC on both networks, USDT0 on Arbitrum One (both EIP-3009).
  Payers refuse any other asset. Gas token is ETH; `balance()` returns `{ usdc, eth }`
  and the wallet tool is `transfer_eth`.
- **npm scope:** packages move from `@chainpeavax/*` to `@chainpe/*`
  (`@chainpe/sdk`, `@chainpe/cli`, `@chainpe/agent`, `@chainpe/ai-tools`).
- **Defaults:** SDK and CLI default to Arbitrum One; the wallet and agent default
  to Arbitrum Sepolia.

### Removed
- ICM / Teleporter cross-L1 contracts and docs.
- Avalanche and Fuji network support.
- The Docusaurus static docs copies; docs are served by the landing site.

---

## 2026-06-17 — Avalanche mainnet deployment

### Mainnet deployment

- All contracts deployed and live on **Avalanche C-Chain mainnet (chainId 43114)**:
  - `ChainPeRegistry` (UUPS proxy) at `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`
  - `PolicyVault` (UUPS proxy) at `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8`
  - ERC-8004 Identity, Reputation, Validation registries (UUPS proxies) — see `docs/DEPLOYMENTS.md`
  - `ChainPeICMReceiver` / `ChainPeICMSender` for Avalanche ICM cross-L1 payments
- Fee token updated to Circle USDC on Avalanche C-Chain (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
- SDK default network changed from `'fuji'` to `'avalanche'`
- x402 network id is `avalanche` (mainnet); `avalanche-fuji` remains available for testnet opt-in
- Hosted facilitator and indexer live on Railway; dashboard deployed on Railway/Vercel
- 92 passing contract + workspace tests

---

## [1.0.0] - 2024-07

### Added
- Initial release of ChainPe x402 reverse proxy gateway
- `chainpe init` — interactive setup wizard saving config to `.env`
- `chainpe start` — starts the proxy reading from `.env`
- Optimistic proxying: verify locally (~10ms), proxy immediately, settle on-chain asynchronously
- Local Avalanche facilitator — full on-chain verify/settle for Avalanche C-Chain mainnet and Fuji testnet
- Per-route pricing via `routes.json`
- Admin endpoints: `/chainpe-admin/stats` and `/chainpe-admin/health`
- In-memory rate limiting per IP
- Graceful shutdown with settlement queue draining
- Structured JSON logging with `verbose` / `normal` / `quiet` levels
- `CHAINPE_LOG_LEVEL` environment variable support
- Programmatic API: `startProxyServer()` exported from package root
- Full TypeScript types exported for all public interfaces
