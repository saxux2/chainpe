# Phase 6 — Arbitrum Sepolia validation

Scripts for the implementation guide's Phase 6. They use four wallets whose keys live only in gitignored files:

| Role | Key | Needs | Does |
|---|---|---|---|
| deployer | `DEPLOYER_PRIVATE_KEY` in `contracts/.env` | ~0.01 ETH | deploys, tops up the others' gas, relays vault spends |
| payer | `CHAINPE_PRIVATE_KEY` in `.env` | ≥ 3 USDC | pays x402 calls, posts reviews, owns the vault deposit |
| provider | `PROVIDER_PRIVATE_KEY` in `.env` | ≥ 1 USDC | ERC-8004 identity, registers the service (1 USDC fee), receives payments |
| session | `SESSION_PRIVATE_KEY` in `.env` | nothing | signs vault spends |

Every recorded transaction goes to `e2e/testnet/.phase6/log.jsonl` (gitignored). `node e2e/testnet/status.mjs --log` prints them for `docs/DEPLOYMENTS.md`.

Run everything from the repo root after `npm run build`.

## 0. Fund and deploy

1. Send Arbitrum Sepolia ETH to the deployer. Get USDC from [faucet.circle.com](https://faucet.circle.com) (network "Arbitrum Sepolia") for the payer and the provider.
2. `node e2e/testnet/status.mjs`: every wallet should show ✓ except possibly payer/provider ETH.
3. `node e2e/testnet/fund.mjs` sends gas money from the deployer to the payer and provider.
4. `cd contracts && npm run deploy:sepolia && npm run deploy:policyvault:sepolia`. This writes `contracts/deployments/arbitrumSepolia*.json`, including `deployBlock`. With `ETHERSCAN_API_KEY` set, also run `npm run verify:sepolia`.

## 1. Provider

```bash
node e2e/testnet/register.mjs          # ERC-8004 identity + register "ChainPe Phase6 Weather"
node e2e/testnet/provider.mjs          # leave running (x402 proxy on :4021, settles through PayAI)
```

Indexer (separate terminal; Postgres in Docker):

```bash
docker run -d --name chainpe-phase6-pg -e POSTGRES_PASSWORD=chainpe -e POSTGRES_DB=chainpe -p 55439:5432 postgres:16-alpine
cd services/chainpe-indexer
DATABASE_URL=postgres://postgres:chainpe@127.0.0.1:55439/chainpe NETWORK=arbitrum-sepolia \
CHAINPE_REGISTRY_ADDRESS=<registry proxy> START_BLOCK=<deployBlock> PORT=4600 npx tsx src/server.ts
```

## 2–3. Payers and reputation

```bash
node e2e/testnet/pay.mjs sdk      # @chainpe/sdk: pays, checks the USDC Transfer, posts a review
node e2e/testnet/pay.mjs agent    # @chainpe/agent: discovers via the registry, pays, reviews
```

**Wallet MCP (manual, Claude Desktop):** run `npm run build:mcpb` and install the `.mcpb`. Set network `arbitrum-sepolia`, the payer's private key (paste it yourself from `.env`) and the registry address. Then ask Claude: *"Use x402_fetch on http://localhost:4021/weather?city=Paris"*. The tool pays and posts the review itself. Record its settlement and feedback hashes by hand.

Check: `curl localhost:4600/agents/<agentId>/reputation` shows `unverifiedCount: 0`. Each review is a row with `verified = true` in the `feedback` table. `count` counts distinct reviewers, so three reviews from one payer show `count: 1`.

## 4. Failover

Stop the provider and start it with a dead facilitator in front of PayAI:

```bash
FAILOVER=1 node e2e/testnet/provider.mjs
STEP=6.4 node e2e/testnet/pay.mjs sdk
```

The provider logs `Facilitator http://127.0.0.1:9 … failed`, and the payment still settles.

## 5. PolicyVault

```bash
node e2e/testnet/vault.mjs
```

This deposits 2 USDC and sets maxPerCall 0.5 / dailyCap 1 / totalBudget 2. It relays two 0.5 spends to the provider (the deployer pays gas), expects the third to revert with `OverDailyCap`, and withdraws the remaining 1 USDC. Run it once per UTC day: the daily cap does not reset sooner.

## Local rehearsal

To dry-run the scripts on a Hardhat fork of Arbitrum Sepolia (real USDC and ERC-8004 contracts, no faucet), start `HARDHAT_CHAIN_ID=421614 npx hardhat node --fork https://sepolia-rollup.arbitrum.io/rpc`. Give the wallets balances with `hardhat_setBalance`, and give USDC by writing FiatToken's balance slot (mapping at slot 9). Then set `ARBITRUM_SEPOLIA_RPC_URL`, `PHASE6_DIR` (keeps the real log clean), `CHAINPE_REGISTRY_ADDRESS` and `POLICY_VAULT_ADDRESS`. Settle with `FACILITATOR_KEY=<gas key>` (in-process), or with `BACKUP_FACILITATOR_URL` pointing at a local `services/chainpe-facilitator`, because PayAI can't see the fork. Move `contracts/deployments/arbitrumSepolia*.json` away afterwards.
