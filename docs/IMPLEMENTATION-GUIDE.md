# ChainPe on Arbitrum — Implementation Guide

This guide covers every job left in the Avalanche → Arbitrum migration **except deploying contracts and hosting services**. Work through the phases in order. Each task lists the files to touch, the steps, and how to know it's done.

Last updated: 2026-09-28 (Phase 6).

---

## 0. Where things stand

**Already done (step 1):**
- All packages run on `arbitrum` (Arbitrum One, default for SDK/CLI) and `arbitrum-sepolia` (default for wallet/agent). Avalanche and Fuji are removed.
- Every package uses x402 v2 (`@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` 2.27.0).
- `packages/chainpe-sdk/src/networks.ts` is the single chain table. The CLI, wallet, agent and ai-tools import from it.
- ERC-8004 points at the canonical registries (`0x8004…`), not self-deployed copies.
- The provider proxy defaults to PayAI's facilitator; `--facilitator <key>` settles in-process.
- `services/chainpe-facilitator` serves several networks (`NETWORKS=arbitrum,arbitrum-sepolia`).
- Hardhat targets `arbitrum` / `arbitrumSepolia`, with Arbiscan verification through `ETHERSCAN_API_KEY`.

**Phase 1 — done 2026-09-28.** Differences from the plan below:
- 1.1: Avalanche deployment files were moved to `contracts/deployments/archive-avalanche/`.
- 1.2/1.3: implemented in `packages/chainpe/src/proxy/facilitators.ts` and `failoverFacilitator.ts`, with 16 tests in `packages/chainpe/__tests__/facilitators.test.ts`. `chainpe start --facilitator-url <url>` overrides the configured list.
- 1.4: USDT0 on Arbitrum One was **confirmed to support EIP-3009** (EIP-712 name `USD₮0`, version `1`), so it needs no Permit2. Tokens live in the SDK's `NETWORKS[n].tokens`; payers (SDK, wallet, agent) now refuse any asset not in that table. The SDK has `approvePermit2()` for future Permit2 tokens; the wallet `approve_token` tool was skipped because no configured token needs it.
- 1.5: no contract change needed. Added three timing tests and NatSpec notes; the SDK's default spend deadline is now 10 minutes.
- Found while testing: Hardhat's default account #0 has an EIP-7702 delegation on Arbitrum One, so its signatures fail verification there. Never use Hardhat's public keys on a live network.

**Phase 2 (2.1–2.3) — done 2026-09-28.** 2.4 still needs a CDP-settled payment. Differences from the plan below:
- 2.1: discovery helpers live in `packages/chainpe/src/proxy/discovery.ts`. `discovery` also takes `inputExample` / `outputExample`, because x402 only publishes the output schema together with an example. The listing verdict is logged from the resource server's `onAfterSettle` hook, not the payment-tracking middleware: x402 strips `extensionResponses` from the buyer-facing `PAYMENT-RESPONSE` header. `chainpe init` reads `inputSchema` / `outputSchema` / `method` from `/schema`, or only the method from ChainPe's `{ routes: [...] }` shape.
- 2.2: CDP's **list** endpoint ignores the `network` filter (17k+ mostly-Base items), and **search** rejects `limit > 20` with HTTP 400. `searchBazaar` therefore always searches (tags stand in for a missing query; with neither it returns nothing) and caps the limit at 20. `ChainPeService.paymentToken` is now `TokenSymbol`.
- 2.3: merged discovery is `discoverServices()` in `packages/chainpe-sdk/src/discovery.ts`, also used by `chainpe discover`, `chainpe-ai-tools`, the wallet and the agent. ERC-8004 registration files carry no price, so each listed endpoint not already known is probed once for its 402 offer (max 25 agents, 5 endpoints each). The agent keeps a per-run cache of discovered services so `callPaidApi` can call Bazaar-only services; the agent's `registry.ts` helpers (`loadRegistry`, `searchServices`, …) were removed from its public API.
- 2.4 (partly observed): CDP's Bazaar does list Arbitrum One resources — a live search on 2026-09-28 returned USDC-on-`eip155:42161` services (e.g. `x402tap.com/api/weather`). ChainPe's own listing is still unverified.

**Phase 3 (3.1–3.4) — done 2026-09-28.** 3.5 still needs testnet contracts. Differences from the plan below:
- 3.1: the feedback file uses the ERC-8004 spec's field names (`value`/`valueDecimals`, CAIP-10 `agentRegistry` and `clientAddress`, string `chainId`), not the `score` sketch below. It is serialised as canonical JSON (sorted keys) into a `data:` URI; `feedbackHash` is the keccak256 of those exact bytes, so verifiers hash what they fetch and never re-serialise. `giveFeedback` always writes a file; `proofOfPayment` is added when a `payment: { txHash, payTo }` is passed. The wallet's `give_feedback` tool takes optional `paymentTxHash` + `payTo`.
- 3.2: verification lives in `services/chainpe-indexer/src/verify.ts` (16 tests in `__tests__/verify.test.ts`). Beyond the plan: one payment backs at most one verified review; the proof's `chainId`, `agentId` and `clientAddress` must match the event; only public `https://` or `ipfs://` (via `IPFS_GATEWAY`) URIs are fetched, capped at 64 KB, so an on-chain URI can't reach internal hosts; transient RPC errors on the receipt lookup retry the block range instead of storing "unverified". Feedback for agent ids not linked to a ChainPe service is skipped at index time, so feedback posted before its service is registered is never stored. Rows indexed before this change stay unverified. New endpoint: `GET /agents/:agentId/reputation`.
- 3.3: the wallet and agent `reputation.ts` copies are deleted. The shared post-payment path is the SDK's `submitPaidCallFeedback()` (used by `ChainPe.fetch/pay`, wallet `x402_fetch` and agent `callPaidApi`). The agent package now re-exports the SDK's `getReputation` / `giveFeedback` (their signatures changed).
- 3.4: the SDK reads `/agents/:agentId/reputation` (not `/services/:id/…`, since callers hold agent ids) from `CHAINPE_INDEXER_URL` or the new `indexerUrl` option, and ignores an indexer serving another network. **Deviation:** without an indexer the on-chain fallback still aggregates over all clients by default (callers can pass `clients`), labelled `verified: false`. The canonical registry keeps `feedbackURI` only in events, so the SDK can't filter payers on its own; returning nothing would have removed ranking for everyone without an indexer. `ReputationSummary` now has `verified` (and `unverifiedCount` from the indexer); the wallet, agent and ai-tools show it.

**Phase 4 (4.1–4.5) — done 2026-09-28.** Differences from the plan below:
- 4.5 (decided first, because every install command depends on it): the npm scope is renamed to **`@chainpe`** (`@chainpe/sdk`, `/cli`, `/agent`, `/ai-tools`); the wallet stays `chainpe-wallet-mcp`. All imports, `package.json` files, tsup externals and docs use the new names, and the workspace lockfile is regenerated. Still to do in Phase 7: make sure the `@chainpe` npm org is yours, and publish a final `@chainpeavax/*` release whose README points to the new names.
- Repo URLs use the placeholder `https://github.com/OWNER/chainpe` (package.json `repository`/`homepage`/`bugs`, wallet `manifest.json`, READMEs, landing links). Replace `OWNER` in Phase 7.5.
- 4.1: `docs/WHY-AVALANCHE.md` is replaced by `docs/WHY-ARBITRUM.md`, with a gas price measured on 2026-09-28 (0.02 gwei, ETH $2,643). `docs/DEPLOYMENTS.md` has empty Arbitrum tables for Phase 6 and an "Archived (Avalanche, 2026-06)" section. The fee mismatch is resolved: the Avalanche record says `registrationFee: 1000000`, so the fee was **1 USDC** (the old "0.1 USDC" text was wrong); the Arbitrum deploy default is also 1 USDC.
- 4.2: besides the chain changes, several guides described APIs that don't exist (`AgentRunner`, `WalletManager`, `AgentKeychain`, `chainpe start --backend`, `chainpe register --local`, `routes` in the config file, `x402-express` examples). They now match the code.
- 4.3: the Docusaurus copies in `apps/landing/public/docs` and `apps/dashboard/public/docs` are deleted, with the `dev:docs*` and `build:docs` scripts and the dashboard's `app/docs` route that served them. The dashboard now redirects `/docs` to the landing site's fumadocs pages (`NEXT_PUBLIC_DOCS_URL`, default `https://chainpe.app/docs`). The ICM pages are deleted; fumadocs builds navigation from the files, so nothing else referenced them. `apps/landing/.source/` (generated) is now gitignored.
- 4.4: besides the chain copy, unsupported claims were removed: "99.99% uptime on mainnet", invented latency figures, `network: 'mainnet'` code samples, 1–5 star feedback. One placeholder testimonial (about ICM) was removed rather than replaced; the remaining three are anonymous placeholders and should be replaced with real quotes or removed before launch.
- Also fixed: "MetaMask / Core" wallet labels in the CLI now say "MetaMask / Rabby".
- **Found, not fixed:** `@chainpe/agent` ignores `payment.maxPricePerRequest` in `agent.json`; `PaymentClient` always uses its 10 USDC default. The docs describe the real behaviour.
- **Done-when check (re-run after Phase 5):** the grep lists only (a) the archived deployment files, (b) tests and a comment that reject legacy network names on purpose, (c) migration history in `docs/WHY-ARBITRUM.md`, `docs/DEPLOYMENTS.md`, `docs/STRUCTURE.md`, the README and changelogs, and the `@chainpeavax` note in the FAQ.

**Phase 5 (5.1–5.3) — done 2026-09-28.** Differences from the plan below:
- 5.1 `seller-agents/`: the four AVAX agents are replaced by `arbitrum-price-agent` (ETH/ARB prices, Arbitrum TVL and yields from CoinGecko/DeFiLlama), `arbitrum-news-agent`, `arbitrum-analysis-agent` (BUY/SELL/HOLD on ETH) and `arbitrum-dex-agent`. The DEX agent is **quote-only**: best-route quotes on Arbitrum One from KyberSwap's keyless aggregator API; it never signs or executes a swap, so `DEX_WALLET_KEY` and the live-swap mode are gone. `investment-orchestrator.mjs` therefore paper-trades ETH/USDC at those real quotes (only agent fees are real payments) and prefers ChainPe-registered sellers over look-alike Bazaar listings. Sellers settle through PayAI by default, so the facilitator gas wallet is optional. `mint-identity`, `register-seller` and `register-all` use the CLI's identity helpers, now exported from `@chainpe/cli` (`mintAgentIdentity`, `hasIdentity`, `resolveIdentityRegistry`). `fund-sellers` reads the registry's `registrationFee` on-chain. `chainpe-mcp.mjs`: `rate_agent` takes optional `payment_tx_hash` + `pay_to` for a verified review, and a bug that treated `giveFeedback`'s tx-hash return as an object is fixed; `@modelcontextprotocol/sdk` was missing from `package.json` and is added. Smoke-tested: price and DEX agents return live data and a correct x402 v2 offer on `eip155:421614`.
- 5.1 other examples: `avalanche-bench/` is replaced by `arbitrum-bench/` (live block time + gas price; with `BENCH_PRIVATE_KEY`, one real EIP-3009 settlement of 0.01 USDC to itself, reporting latency and the all-in fee). The USDC EIP-712 domains in the SDK were checked against the on-chain `DOMAIN_SEPARATOR` on both networks. `proxy-railway/` is rewritten on `@x402/express` v2 (PayAI default). `policy-vault/` uses `POLICY_VAULT_ADDRESS` and the SDK's network table. `weather-api/` and `weather-railway/` were chain-agnostic (comment fix only).
- 5.2: `run.mjs` and `agent-to-agent.mjs` (ported earlier) now also assert the v2 `PAYMENT-REQUIRED` / `PAYMENT-RESPONSE` headers. `mainnet-real-usdc.mjs` is replaced by `mainnet-arbitrum-usdc.mjs` (`npm run test:e2e:mainnet`): refuses to run without `CONFIRM_MAINNET=yes`, takes `MAINNET_PRIVATE_KEY` (not the deployer key), asserts chain id 42161, `network === "eip155:42161"`, the native USDC address on the decoded offer and receipt, and a USDC log in the settlement tx; the registry flow runs only when `CHAINPE_REGISTRY_ADDRESS` is set. Not executed (needs real funds).
- 5.3: `e2e/local.test.mjs` (node:test, ~8 s) starts a Hardhat node with chain id 421614 (`HARDHAT_CHAIN_ID`, new in `hardhat.config.ts`), places MockUSDC at the canonical Arbitrum Sepolia USDC address (`setCode` + name/symbol storage), deploys ChainPeRegistry, runs the CLI proxy with an in-process facilitator, and checks: the 402 offer, an SDK payment settled on-chain with the facilitator paying gas and USDC moving payer → provider, the `maxPerCall` refusal, and registry discovery + payment from the discovery result. So the SDK, proxy and x402 packages run unmodified. MockUSDC gained `authorizationState()` (real USDC has it; x402 facilitators read it). Root `npm test` now ends with `npm run test:e2e:local` (needs `npm run build` and the contracts' dependencies). Added `.github/workflows/ci.yml` (install, build, typecheck, Hardhat tests, `npm test`); it runs once the repo is on GitHub.

**Phase 6 (6.1–6.5) — done on Arbitrum Sepolia 2026-09-28.** Registry `0x3f1fC54d8A5AD97Cf72a9A46a813640630dcB783` and PolicyVault `0x9F363Ed70c49701Af50638fDd7849a164295b416` are deployed; every transaction is in `docs/DEPLOYMENTS.md`. 6.1, 6.2 (SDK, agent, and the wallet MCP in Claude Desktop), 6.3 (all four reviews `verified` by the indexer), 6.4 and 6.5 passed live, settling through PayAI. Faucets refused the fresh deployer, so its ETH was mined on Ethereum Sepolia (PoW faucet) and bridged with `e2e/testnet/bridge.mjs`. The contracts are not verified on Arbiscan yet (needs `ETHERSCAN_API_KEY`). `npm run build:mcpb` can't work until `@chainpe/sdk` is on npm (Phase 7), so the wallet test runs `packages/chainpe-wallet/dist/index.js` from the repo.
- Scripts live in `e2e/testnet/` (see its README): `status.mjs` (balances + checklist), `fund.mjs` (deployer tops up gas), `register.mjs` (ERC-8004 identity + registers one real service, not `register-demo:sepolia`, whose three endpoints don't exist), `provider.mjs` (the CLI proxy; `FAILOVER=1` puts a dead facilitator in front of PayAI), `pay.mjs sdk|agent`, and `vault.mjs` (hits the daily cap on purpose). Every transaction is logged to `e2e/testnet/.phase6/log.jsonl` (gitignored), for copying into `docs/DEPLOYMENTS.md`. The wallet MCP step stays manual in Claude Desktop.
- Rehearsed end to end on a Hardhat fork of Arbitrum Sepolia (real USDC and canonical ERC-8004 registries, the real deployer/payer/provider keys) with the indexer on Postgres: deploy, identity mint, registration, SDK and agent paid calls settled through the backup facilitator after the dead one failed, both reviews `verified` in the indexer, and the vault rejecting the third spend with `OverDailyCap`. PayAI was confirmed to list `eip155:421614` (x402 v2).
- **Fixed, found in the rehearsal:** `@chainpe/agent`'s `PaymentClient` accepted an `onPayment` callback but never called it; it now fires after each settled payment. The SDK's PolicyVault ABI had no custom errors, so a rejected spend showed only a raw selector (`0xc4891db5`) instead of the reason `relaySpend` promises; the vault's errors are now in the ABI.
- Contracts are owned by the deployer EOA on testnet (`OWNER_ADDRESS` empty); mainnet deploys refuse that.

**Phase 7 — in progress (2026-09-28).** Done: 7.5 — the repo is `github.com/saxux2/chainpe` (every `OWNER` placeholder replaced); every package has `repository`/`homepage`/`bugs`, a LICENSE and `publishConfig.access: public`; `npm pack --dry-run` ships only `dist`, README, LICENSE and `package.json`, and no testnet key appears outside the gitignored `.env` files. `build:mcpb` now drops `devDependencies` before installing, so it no longer needs `@chainpe/sdk` on npm (the SDK is bundled). The wallet README and install docs describe `npx -y chainpe-wallet-mcp`. The wallet's LICENSE keeps its original "402.md" copyright line. **Not done:** 7.2 publishing (npm login on this machine didn't complete; the default registry here is npmmirror, so always pass `--registry=https://registry.npmjs.org`), 7.3 testing the `.mcpb` in Claude Desktop, 7.4 the `@chainpeavax/*` pointer releases (sdk 0.2.1, ai-tools 0.2.3, cli 2.0.2, agent 2.0.1 — the last published code with a "moved to `@chainpe/*`" README) and `npm deprecate`.

**Out of scope for this guide:** deploying ChainPeRegistry / PolicyVault, and hosting the facilitator, indexer and dashboard. Some tasks below say *"needs testnet contracts"* — do those after the testnet deploy.

### Working conventions

| What | Command |
|---|---|
| Install (root workspace) | `npm install --registry=https://registry.npmjs.org` |
| Type-check all packages | `npm run typecheck` |
| Test all packages | `npm test` |
| Build all packages | `npm run build` |
| Contracts | `cd contracts && npx hardhat compile && npx hardhat test` |
| Facilitator / indexer tests | `cd services/<name> && npx vitest run --hookTimeout=180000` |

Rules for every task:
- Keep `npm run typecheck`, `npm test`, `npm run build` and the Hardhat tests green after each task.
- Chain constants go in `packages/chainpe-sdk/src/networks.ts` only. `services/*` keep their own small tables because they build outside the workspace.
- Unknown network names must throw, never fall back to another chain.
- Never put keys in source or chat. Secrets live in gitignored `.env` files.

### Suggested order

| Phase | Tasks | Needs testnet contracts? |
|---|---|---|
| 1 | Finish code migration (1.1–1.5) | No |
| 2 | Bazaar discovery (2.1–2.3) | No (2.4 yes) |
| 3 | Reputation (3.1–3.4) | No (3.5 yes) |
| 4 | Docs and content (4.1–4.5) | No |
| 5 | Examples and e2e (5.1–5.3) | Partly |
| 6 | Testnet validation (6.1–6.4) | **Yes** |
| 7 | Publish and relaunch (7.1–7.5) | After 6 |
| 8 | Optional: Robinhood Chain | After mainnet |

---

## Phase 1 — Finish the code migration

### 1.1 Remove ICM / Teleporter

ICM is Avalanche's cross-chain messaging. Nothing on Arbitrum provides it, and the Avalanche setup only looped C-Chain to itself, so no real traffic is lost.

**Delete:**
- `contracts/contracts/icm/ChainPeICMReceiver.sol`
- `contracts/contracts/icm/ChainPeICMSender.sol`
- `contracts/contracts/icm/ITeleporter.sol`
- `contracts/contracts/mocks/MockTeleporterMessenger.sol`
- `contracts/scripts/deploy-icm.ts`
- `contracts/scripts/configure-icm.ts`
- `contracts/test/ChainPeICM.test.ts`

**Edit:**
- `contracts/scripts/transfer-ownership.ts` — remove the block that reads `<network>-icm.json` and adds `ChainPeICMReceiver` (around lines 56–60).
- `contracts/deployments/` — move all `avalanche*.json` and `fuji*.json` into `contracts/deployments/archive-avalanche/`. They are the historical record of the old deployment; don't delete them outright.

**Leave for Phase 4:** the ICM mentions in `README.md`, `docs/`, and `apps/landing` (`concepts/icm-cross-chain.md`, `smart-contracts/icm-receiver.md`, the landing sections).

**Steps:**
1. Delete the files listed above.
2. Make the `transfer-ownership.ts` edit.
3. Move the old deployment JSON files.
4. `cd contracts && npx hardhat clean && npx hardhat compile && npx hardhat test`.
5. `grep -rniE "icm|teleporter" contracts --include=*.ts --include=*.sol` should return nothing outside `node_modules`, `artifacts` and `typechain-types`.

**Done when:** contracts compile, Hardhat tests pass (the ICM tests are gone, so expect fewer than 90), and no code references ICM.

---

### 1.2 Add Coinbase CDP as a facilitator

CDP is Coinbase's hosted facilitator. It's the only one with `upto` and `batch-settlement` on Arbitrum, and settling through it is what lists a service in the CDP Bazaar (Phase 2). It needs API keys for `/verify` and `/settle`. It covers Arbitrum One but **not** Arbitrum Sepolia, so testnet keeps using PayAI.

**Package:** `@coinbase/x402@^2.1.0` (built on `@x402/core` v2). It exports `createFacilitatorConfig(keyId, keySecret)` and reads `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`.

**Files:**
- `packages/chainpe/package.json` — add `@coinbase/x402`.
- `packages/chainpe/src/types.ts` — add to `ChainPeConfig`:
  ```ts
  /** Ordered facilitator list; first one that supports the network wins. */
  facilitators?: FacilitatorSpec[];
  ```
  ```ts
  export type FacilitatorSpec =
    | { kind: "cdp" }                          // uses CDP_API_KEY_ID / CDP_API_KEY_SECRET
    | { kind: "payai" }                        // https://facilitator.payai.network
    | { kind: "url"; url: string };            // any x402 v2 facilitator (e.g. your own)
  ```
  Keep `facilitatorUrl` working: treat it as `[{ kind: "url", url }]`.
- New file `packages/chainpe/src/proxy/facilitators.ts` — turns `FacilitatorSpec[]` into `FacilitatorClient[]`:
  ```ts
  import { HTTPFacilitatorClient } from "@x402/core/server";
  import { createFacilitatorConfig } from "@coinbase/x402";

  export function buildFacilitatorClients(specs: FacilitatorSpec[]): FacilitatorClient[] {
    return specs.map((s) => {
      if (s.kind === "cdp") {
        const id = process.env.CDP_API_KEY_ID, secret = process.env.CDP_API_KEY_SECRET;
        if (!id || !secret) throw new Error("CDP facilitator needs CDP_API_KEY_ID and CDP_API_KEY_SECRET.");
        return new HTTPFacilitatorClient(createFacilitatorConfig(id, secret));
      }
      if (s.kind === "payai") return new HTTPFacilitatorClient({ url: DEFAULT_FACILITATOR_URL });
      return new HTTPFacilitatorClient({ url: s.url });
    });
  }
  ```
- `packages/chainpe/src/proxy/server.ts` — replace the single `facilitator` with the list from 1.3.
- `packages/chainpe/src/cli.ts` — in `chainpe init`, ask which facilitator to use (CDP / PayAI / custom URL), defaulting to CDP on `arbitrum` and PayAI on `arbitrum-sepolia`. Add a `--facilitator-url` flag to `start`.
- `.env.example`, `.env.mainnet.example` — add `CDP_API_KEY_ID=` and `CDP_API_KEY_SECRET=` with a comment that they're only needed for CDP.

**Default rule:**

| Network | Default list |
|---|---|
| `arbitrum` | CDP (if keys set) → PayAI |
| `arbitrum-sepolia` | PayAI |

**Tests** (`packages/chainpe/__tests__/facilitators.test.ts`, new):
- `cdp` without env keys throws a clear error.
- `facilitatorUrl` only → one URL client.
- The default list for each network matches the table.

**Done when:** `chainpe start` on `arbitrum` with CDP keys logs "Using facilitators: CDP → PayAI". Without keys, CDP is skipped with a warning and PayAI is used.

---

### 1.3 Facilitator fallback

**Where it goes:** fallback only matters where facilitators are **called**, which is the provider proxy (and your hosted facilitator's callers). The SDK, wallet MCP and agent are payers: they sign a payment and send it to the provider. They never talk to a facilitator, so they need no change.

**Two layers:**

1. **Routing by network (free).** `x402ResourceServer` already accepts an array: `new x402ResourceServer([cdp, payai, own])`. On startup it reads each one's `/supported` and routes each network/scheme to the first facilitator that supports it. This alone gives "CDP for mainnet, PayAI for testnet".

2. **Failover on errors (to build).** If CDP is down, retry on the next one. Add `packages/chainpe/src/proxy/failoverFacilitator.ts`:
   ```ts
   /** Tries each client in order; moves on when one fails with a network/5xx/timeout error. */
   export class FailoverFacilitatorClient implements FacilitatorClient {
     constructor(private readonly clients: FacilitatorClient[]) {}
     verify(p, r)  { return this.first((c) => c.verify(p, r)); }
     settle(p, r)  { return this.first((c) => c.settle(p, r)); }
     async getSupported() { /* merge kinds from every client that answers */ }
     private async first<T>(fn: (c: FacilitatorClient) => Promise<T>): Promise<T> {
       let last: unknown;
       for (const c of this.clients) {
         try { return await fn(c); }
         catch (err) { if (!isRetryable(err)) throw err; last = err; }
       }
       throw last;
     }
   }
   ```
   `isRetryable`: true for fetch errors, timeouts and HTTP 5xx (`FacilitatorResponseError` / `FacilitatorTimeoutError` from `@x402/core/http`); false for a clean `isValid: false` / `success: false` answer, which is a real rejection, not an outage.

**Why retrying `settle` is safe:** the payer's EIP-3009 authorization has a unique nonce. If the first facilitator actually settled before failing, the second one's attempt reverts with "authorization used". No double payment is possible. Log that case clearly, since it means the first facilitator settled but didn't report it.

**Wire-up in `server.ts`:** group clients per network. For each network, wrap the facilitators that support it in one `FailoverFacilitatorClient` and pass those wrappers to `x402ResourceServer`.

**Hosted facilitator (`services/chainpe-facilitator`):** no change. It's one of the facilitators in the list (`{ kind: "url" }`).

**SDK cleanup:** `ChainPeOptions.facilitatorUrl` in `packages/chainpe-sdk/src/types.ts` is unused by the payer flow. Mark it `@deprecated` in the doc comment; don't remove it until the next major version.

**Tests** (`packages/chainpe/__tests__/failover.test.ts`, new, with fake clients):
- First client throws a timeout → second client's result is returned.
- First client returns `isValid: false` → returned as-is, second client never called.
- All clients fail → last error is thrown.
- `getSupported` merges kinds.

**Done when:** with CDP pointed at a dead URL, a paid request still settles through PayAI, and the log shows the failover.

---

### 1.4 Permit2 / USDT0 support (optional)

Only needed if providers want to be paid in a token other than USDC. USDC on Arbitrum supports EIP-3009, so today's flow already works for it.

**Facts checked on 2026-09-28:**
- Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) and x402's Permit2 proxies (`0x402085c2…0001` exact, `0x4020A4f3…0002` upto) are deployed on **both** Arbitrum One and Arbitrum Sepolia.
- USDT0 on Arbitrum One is `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` (name `USD₮0`). A read-only probe suggests it exposes EIP-3009 authorization functions. **Not confirmed** — do one real signed transfer on mainnet before relying on it.
- USDT0 is not in x402's default asset table for Arbitrum, so it must be configured explicitly.

**Client side (SDK, wallet, agent):** nothing to build. `ExactEvmScheme` from `@x402/evm/exact/client` already signs both EIP-3009 and Permit2 payloads, based on what the 402 offer asks for. The one real gap is that Permit2 needs a **one-time ERC-20 approval** to the Permit2 contract, which costs the payer gas:
- Add `approvePermit2(token)` to the SDK (`packages/chainpe-sdk/src/chainpe.ts`) using `createPermit2ApprovalTx` from `@x402/evm`.
- Add an `approve_token` tool to the wallet MCP.
- In both, when a payment fails because the allowance is missing, return an error that says to run the approval first.

**Provider side (CLI proxy):**
- `packages/chainpe/src/types.ts` — widen `PaymentToken` to `"USDC" | "USDT0"`.
- `packages/chainpe-sdk/src/networks.ts` — add an optional `tokens` map per network: `{ USDT0: { address, decimals: 6, name: "USD₮0", version: "1", transferMethod: "eip3009" | "permit2" } }`. Fill in `version` from the token's `eip712Domain()` or `DOMAIN_SEPARATOR` before shipping.
- `packages/chainpe/src/proxy/routeConfig.ts` — for USDC keep the `"$0.01"` price. For other tokens, pass an asset amount instead:
  ```ts
  price: { amount: toAtomic(price, 6), asset: token.address,
           extra: { name: token.name, version: token.version,
                    ...(token.transferMethod === "permit2" ? { assetTransferMethod: "permit2" } : {}) } }
  ```
- `packages/chainpe/src/cli.ts` — in `init`, allow choosing USDT0 on `arbitrum` only.

**Tests:**
- Route config for USDT0 produces an offer with the USDT0 asset and the right `extra`.
- SDK signs a Permit2 offer (decode the header; the payload has `permit2Authorization` instead of `authorization`).

**Done when:** a provider priced in USDT0 returns a correct 402 offer, and the SDK can pay it after `approvePermit2`. The live mainnet payment is confirmed in Phase 6.

---

### 1.5 PolicyVault timing on Arbitrum

**Checked:** no ChainPe contract uses `block.number`. `PolicyVault.sol` and `PolicyVaultUpgradeable.sol` use `block.timestamp` for:
- session `expiry` (`block.timestamp > p.expiry`)
- signature `deadline`
- the daily cap bucket (`block.timestamp / 1 days`)

`block.timestamp` on Arbitrum is real Unix time set by the sequencer, so this logic works unchanged. **No contract change is needed.**

What's left:
1. **Add a test** to `contracts/test/PolicyVaultUpgradeable.test.ts` that pins the behaviour:
   - A spend at 23:59:59 UTC and one at 00:00:01 UTC the next day fall into different daily buckets.
   - A session is rejected one second after `expiry`.
   (Use `time.increaseTo` from `@nomicfoundation/hardhat-toolbox/network-helpers`.)
2. **Document the tolerance.** Arbitrum's sequencer may set timestamps up to about 24 hours in the past or 1 hour in the future relative to L1. Add one line to the PolicyVault NatSpec: expiries and deadlines are accurate to roughly an hour, so don't use windows much shorter than that.
3. **SDK default:** check that `PolicyVaultClient.signSpend` uses a deadline of at least 10 minutes. If it's shorter, raise it.
4. **Guard for later:** add a comment at the top of both PolicyVault contracts: "Use `block.timestamp`, never `block.number` — on Arbitrum `block.number` is the L1 block."

**Done when:** the new tests pass and the NatSpec notes are in.

---

## Phase 2 — Discovery (x402 Bazaar)

### 2.1 Declare Bazaar metadata on the provider proxy

**Package:** `@x402/extensions` (already installed as a dependency of `@x402/express`). Use `declareDiscoveryExtension` from `@x402/extensions/bazaar`.

**Files:**
- `packages/chainpe/package.json` — add `@x402/extensions` as a direct dependency.
- `packages/chainpe/src/types.ts` — add to `ChainPeConfig`:
  ```ts
  discovery?: {
    enabled: boolean;                 // default true on arbitrum
    inputSchema?: object;             // JSON Schema of the request (query or body)
    outputSchema?: object;            // JSON Schema of the response
    method?: "GET" | "POST";
  };
  ```
- `packages/chainpe/src/proxy/routeConfig.ts` — when discovery is enabled, add `extensions: declareDiscoveryExtension({...})` to each route, using the service name, description and tags already in the config.
- `packages/chainpe/src/cli.ts` — in `init`, offer to fetch `${target}/schema` (the admin route already proxies it) and use it for `inputSchema`/`outputSchema`.

**How listing works:** CDP lists a resource after its **first successful paid settlement through CDP** with the extension declared. The facilitator replies with an `EXTENSION-RESPONSES` header saying whether the listing was accepted. Log that header in the proxy's payment-tracking middleware.

**Done when:** the 402 offer includes the `bazaar` extension, and the proxy logs the listing result after a CDP settlement (verified in Phase 6).

### 2.2 Search Coinbase's Bazaar from the SDK

- New `packages/chainpe-sdk/src/bazaar.ts`:
  - `searchBazaar({ query?, network, maxPrice? })` calls CDP's public discovery API. Listing and search need no API key. Wrap the facilitator client with `withBazaar` from `@x402/extensions/bazaar` to get typed `list`/`search` calls.
  - Filter to `network === getX402Network(network)` and `scheme === "exact"`.
  - Map results to the existing `RankedService` shape with `source: "bazaar"`.
- `packages/chainpe-sdk/src/types.ts` — add `source: "registry" | "bazaar" | "erc8004"` to `ChainPeService`.

### 2.3 One merged discovery everywhere

- `ChainPe.discover()` (SDK) merges three sources, then de-duplicates by endpoint URL:
  1. ChainPeRegistry (if an address is configured)
  2. Coinbase Bazaar (2.2)
  3. ERC-8004 Identity Registry: agents whose registration file lists an x402 endpoint. Read `tokenURI` for the service's `agentId`; don't scan the whole registry.
- Wallet MCP `search_bazaar` (`packages/chainpe-wallet/src/tools/bazaar-search.ts`) — call the SDK's `discover()` instead of its own `RegistryClient`. Update the tool description to say it searches the ChainPe registry **and** Coinbase's Bazaar.
- Agent `discoverService` tool — same: call the SDK.
- Delete the duplicate registry readers once nothing uses them: `packages/chainpe-wallet/src/chainpe-registry.ts`, `packages/chainpe-agent/src/registry.ts`.
- Discovery must still work when the registry address is unset (Bazaar results only).

**Tests:**
- Mocked Bazaar response → results filtered to Arbitrum and tagged `source: "bazaar"`.
- Same endpoint in registry and Bazaar → one result, registry data preferred.

### 2.4 Confirm Arbitrum listings (needs testnet contracts and a CDP-settled payment)

The research **inferred**, but didn't observe, that CDP's Bazaar lists Arbitrum resources. After the first CDP settlement on Arbitrum One, search the Bazaar for your service and record the result in `docs/DEPLOYMENTS.md`.

---

## Phase 3 — Reputation

### 3.1 Payment proof in feedback

ERC-8004 feedback has an off-chain JSON file whose hash goes on-chain as `feedbackHash`. The spec defines an optional `proofOfPayment` block.

- `packages/chainpe-sdk/src/reputation.ts` — change `giveFeedback` to:
  1. Build the feedback file:
     ```json
     { "agentId": "…", "score": 100, "tag1": "x402", "tag2": "x402-success",
       "endpoint": "…", "createdAt": "…",
       "proofOfPayment": { "fromAddress": "0x…", "toAddress": "0x…",
                           "chainId": 42161, "txHash": "0x…" } }
     ```
  2. Hash it (`keccak256` of the canonical JSON) and pass it as `feedbackHash`.
  3. Pass a `feedbackURI`. Start with a `data:application/json;base64,…` URI so no hosting is needed. Add IPFS later if the files get large.
- `ChainPe.pay()` / `fetch()` auto-feedback — pass the settlement `txHash` and `payTo` from the payment into the proof.
- Wallet `x402_fetch` auto-feedback and the agent's `callPaidApi` — same, via the SDK function (see 3.3).

### 3.2 Score only paying reviewers (indexer)

The ERC-8004 spec warns that unfiltered summaries are open to Sybil attacks, and ChainPe currently scores over **all** reviewers.

- `services/chainpe-indexer/src/schema.ts` — add `verified boolean` and `paymentTx text` to the feedback table (with a migration in `ensureSchema`).
- `services/chainpe-indexer/src/indexer.ts` — on `NewFeedback`:
  1. Fetch `feedbackURI` (decode `data:` URIs; fetch `https://` / `ipfs://` with a timeout).
  2. Check its hash equals the on-chain `feedbackHash`.
  3. Load the receipt for `proofOfPayment.txHash`. Check it contains a USDC `Transfer` from the reviewer (`clientAddress`) to the service's `payTo`.
  4. Store `verified = true` only if all checks pass.
- `services/chainpe-indexer/src/core.ts` — compute `score` and `count` from verified feedback only. Also expose `unverifiedCount` so the UI can show it.
- Skip feedback for `agentId`s that aren't ChainPe services. The Reputation Registry is shared by every agent on Arbitrum; don't store what you won't rank.

**Tests** (`services/chainpe-indexer/__tests__/core.test.ts`):
- Verified and unverified feedback → only verified counted.
- Hash mismatch → unverified.
- Transfer to the wrong address → unverified.

### 3.3 One scoring implementation

There are three copies of the reputation client: `packages/chainpe-sdk/src/reputation.ts`, `packages/chainpe-wallet/src/reputation.ts`, `packages/chainpe-agent/src/reputation.ts`.

- Keep the SDK's. Make the wallet and agent call it (the wallet bundles the SDK, and the agent depends on it).
- Delete the wallet and agent copies, and update their tests to mock the SDK functions instead.

### 3.4 Read reputation from the indexer when available

- SDK `getReputation()` — if `CHAINPE_INDEXER_URL` is set, read `/services/:id/reputation` (verified score). Otherwise fall back to the on-chain `getSummary`, but pass only the client list of known payers when possible, never all clients.
- Label the result `verified: true | false` so callers know which kind of score they got.

### 3.5 Live check (needs testnet contracts)

After a real paid call on Arbitrum Sepolia, post feedback and confirm the indexer marks it `verified`. Record the transactions in `docs/DEPLOYMENTS.md`.

---

## Phase 4 — Docs and content

About 100 files still describe Avalanche. Update each in place; don't leave "coming soon" notes.

### 4.1 Repo docs
- `README.md` — rewrite the intro, architecture, quick start (Arbitrum Sepolia), network table, and the contract addresses section. Fix the clone URL to your new repo.
- `docs/WHY-AVALANCHE.md` → replace with `docs/WHY-ARBITRUM.md`: native USDC, Coinbase and PayAI facilitators, canonical ERC-8004 registries, x402 Bazaar, costs.
- `docs/DEPLOYMENTS.md` — move the Avalanche section under "Archived (Avalanche, 2026-06)". Add an empty Arbitrum section for Phase 6 to fill in. Fix the 1 USDC vs 0.1 USDC registration-fee mismatch.
- `docs/STRUCTURE.md`, `docs/CHANGELOG.md` — remove ICM; add a changelog entry for the migration (x402 v2, Arbitrum, canonical ERC-8004, multi-network facilitator).

### 4.2 Package READMEs and setup guides
- `packages/chainpe/README.md`, `packages/chainpe/PROVIDER-SETUP.md`
- `packages/chainpe-agent/README.md`, `packages/chainpe-agent/CONSUMER-SETUP.md`
- `packages/chainpe-sdk/README.md` — including the `balance()` return shape (`{ usdc, eth }`) and the options table.
- `packages/chainpe-ai-tools/README.md`
- `packages/chainpe-wallet/README.md` — the tool list (`transfer_eth`), the network values, and Claude Desktop config.
- `services/chainpe-facilitator/README.md`, `DEPLOY.md` — `NETWORKS`, x402 v2, ETH gas.
- `services/chainpe-indexer/README.md` — required `START_BLOCK`, canonical Reputation Registry.

### 4.3 Landing site docs (`apps/landing/content/docs/**`)
- Delete `concepts/icm-cross-chain.md` and `smart-contracts/icm-receiver.md`, and remove them from the docs navigation.
- Update every page that has Snowtrace links, chain ID 43114, Avalanche USDC or Fuji faucets.
- Replace the invalid Reputation address (`0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543`) with the canonical Arbitrum ones.
- Rebuild the static copies in `apps/landing/public/docs` and `apps/dashboard/public/docs` (the `dev:docs:rebuild` script expects a `website/` Docusaurus folder that isn't in the repo — either restore it or change the script).

### 4.4 Marketing copy
- `apps/landing/components/landing/*` — features, infrastructure, integrations, testimonials and footer sections: remove ICM and "sub-second finality" Avalanche claims, and add Arbitrum, Bazaar and ERC-8004 points.
- `apps/dashboard/src/app/(marketing)/page.tsx` — fix "native AVAX" (payments are USDC).

### 4.5 Branding decision
**Decided 2026-09-28: renamed to `@chainpe`.** The options were:
- **Keep it:** no package renames, but the name says "avax".
- **Rename (e.g. `@chainpe`):** new package names, update every import and `package.json`, and publish a final `@chainpeavax/*` release whose README points to the new names.

**Done when:** `grep -rliE "avalanche|avax|fuji|snowtrace|teleporter" --exclude-dir=node_modules . | grep -v chainpeavax` only returns the archived deployment files and changelog history.

---

## Phase 5 — Examples and end-to-end scripts

### 5.1 Examples (`examples/`)
- `seller-agents/` — replace the AVAX price, AVAX news and Trader Joe DEX agents with Arbitrum equivalents (ETH/ARB price, Arbitrum news, a DEX quote from an Arbitrum DEX aggregator). Remove the WAVAX and Trader Joe router addresses.
- `avalanche-bench/` — delete, or rewrite as `arbitrum-bench` (settlement latency and gas cost on Arbitrum Sepolia).
- `policy-vault/demo.mjs`, `proxy-railway/`, `weather-api/railway/`, `agent-surfaces/` — switch networks, USDC addresses and faucet links; use `POLICY_VAULT_ADDRESS` from env.

### 5.2 End-to-end scripts (`e2e/`)
- `run.mjs`, `agent-to-agent.mjs` — default to `arbitrum-sepolia`, read `FACILITATOR_URL` and registry addresses from env, and assert x402 v2 headers.
- `mainnet-real-usdc.mjs` → rename to `mainnet-arbitrum-usdc.mjs`. Assert `network === "eip155:42161"` and the Arbitrum USDC address. Require an explicit `CONFIRM_MAINNET=yes` env var so it can't spend real money by accident.

### 5.3 A local e2e test that runs in CI
Add `e2e/local.test.mjs`: start a Hardhat node with MockUSDC, deploy the registry, run the provider proxy with the in-process facilitator, and pay from the SDK. This covers the whole flow without testnet funds. Wire it into the root `npm test`.

---

## Phase 6 — Testnet validation (needs testnet contracts)

Run each step on Arbitrum Sepolia and record every transaction hash in `docs/DEPLOYMENTS.md`. The scripts and runbook are in `e2e/testnet/README.md`.

1. **Provider:** register a demo service (`npm run register-demo:sepolia`), then run `chainpe start` against it.
2. **Payers:** make one paid call each from the SDK, the wallet MCP (in Claude Desktop) and the agent. Check the USDC `Transfer` on sepolia.arbiscan.io.
3. **Reputation:** post feedback from each. Confirm the indexer shows it as `verified`.
4. **Failover:** point the first facilitator at a dead URL and confirm payments still settle.
5. **PolicyVault:** deposit, set a session policy, spend through the relayer, and hit the daily cap on purpose.

---

## Phase 7 — Publish and relaunch

1. **Versions:** SDK 0.3.0, ai-tools 0.3.0, CLI 3.0.0, agent 3.0.0, wallet 0.4.0 (already set; bump again if Phases 1–3 add features).
2. **Publish order:** SDK → ai-tools → CLI → agent → wallet (`npm run publish:all` covers the first four; publish the wallet separately).
3. **Claude Desktop extension:** `npm run build:mcpb`, then test the `.mcpb` in Claude Desktop on Arbitrum Sepolia.
4. **Deprecate the Avalanche releases:** `npm deprecate @chainpeavax/cli@"<3" "Avalanche release — upgrade to 3.x for Arbitrum"` (same for the other packages).
5. **New repo:** `git init`, first commit, add the new remote, push. Update every `repository` and `homepage` URL in `package.json` and `manifest.json` first.

---

## Phase 8 — Optional: Robinhood Chain

Only after Arbitrum One mainnet is live. Summary from the research report:
- Chain ID 4663, gas in ETH, stablecoin is **USDG** (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`), not USDC.
- No major hosted facilitator supports it, so it must run through `services/chainpe-facilitator`.
- USDG's EIP-3009 support is disputed; confirm with a real signed transfer first.
- Canonical ERC-8004 registries are live there at the same `0x8004…` addresses.
- L2BEAT rates it "Not even Stage 0" and it halted for 14 minutes on 2026-09-04 — keep it a secondary network.

Work: add `robinhood` to `NETWORKS` in the SDK and to the facilitator's network table, add USDG as its default asset, and use Chainlink CCIP if cross-chain settlement with Arbitrum One is wanted.

---

## Reference

| Item | Arbitrum One (42161) | Arbitrum Sepolia (421614) |
|---|---|---|
| x402 network | `eip155:42161` | `eip155:421614` |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | same |
| Explorer | https://arbiscan.io | https://sepolia.arbiscan.io |
| Facilitators | CDP (keys), PayAI | PayAI, x402.rs |
| Testnet USDC faucet | — | https://faucet.circle.com |

Full research: "ChainPe Arbitrum migration research" (kept outside the repo).
