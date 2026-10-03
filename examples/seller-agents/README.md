# ChainPe — agent-to-agent marketplace (sellers + reputation)

The flagship demo: **agents that get paid to do real work, and agents that hire
them.** LLM-backed seller agents are monetized per request in USDC on Arbitrum; a
buyer orchestrator discovers them (ranked by ⭐ ERC-8004 reputation), hires them
in sequence, pays each, and composes the result — and every paid call leaves
reputation feedback with the payment attached as proof.

```
buyer (orchestrator.mjs)
   │  discover (registry + x402 Bazaar + ERC-8004, ranked by ⭐)
   ├──pay USDC──▶ Research Agent   (LLM)  ──┐
   │                                        │ research brief
   └──pay USDC──▶ News Digest Agent (LLM) ◀─┘  → final digest
        each paid call → ERC-8004 feedback + proof of payment for the seller's agentId
```

| Piece | File |
|---|---|
| Research seller (`POST /research {topic}`) | `research-agent.mjs` |
| News-digest seller (`POST /summarize {text}`) | `news-digest-agent.mjs` |
| Buyer orchestrator (discover → hire both → compose) | `orchestrator.mjs` |
| Price seller — ETH/ARB prices, Arbitrum TVL (`GET /price`, `/defi`) | `arbitrum-price-agent.mjs` |
| News seller — Arbitrum + DeFi news from RSS and DeFiLlama, optional Claude digest (`POST /news`) | `arbitrum-news-agent.mjs` |
| Launcher for the price, news and DEX sellers (`npm run agents`) | `start-arbitrum-agents.mjs` |
| Analysis seller — BUY/SELL/HOLD on ETH (`POST /analyze`) | `arbitrum-analysis-agent.mjs` |
| DEX seller — best-route quotes on Arbitrum One (`POST /quote`) | `arbitrum-dex-agent.mjs` |
| Investment orchestrator (hires all four, paper-trades ETH/USDC) | `investment-orchestrator.mjs` |
| MCP server exposing the marketplace to Claude Desktop | `chainpe-mcp.mjs` |
| Wallet generator / seller funding | `gen-wallets.mjs`, `fund-sellers.mjs` |
| Mint an ERC-8004 identity → `agentId` | `mint-identity.mjs` |
| Register sellers on-chain (one / all) | `register-seller.mjs`, `register-all.mjs` |
| Launchers | `launch.sh`, `demo.sh` |

Each seller runs its backend behind the **same ChainPe x402 gateway** that
`chainpe start` uses (started programmatically via `@chainpe/cli`), so sellers run
side by side. Payments settle through PayAI by default (no keys needed). The
gateway advertises each seller's `agentId` on the 402 so the buyer can leave
feedback without scanning the registry.

## Setup

```bash
# From the repo root, once: build the local @chainpe/* packages.
npm install && npm run build

# Here:
node gen-wallets.mjs      # prints fresh wallets + a .env block
cp .env.example .env      # or paste the generated block; add ANTHROPIC_API_KEY + CHAINPE_REGISTRY_ADDRESS
npm install               # links the local @chainpe/* packages
```

Use **distinct wallets** for the buyer (`CHAINPE_PRIVATE_KEY`) and each seller
(`*_PAYTO`): ERC-8004 blocks self-feedback. Fund the buyer with Arbitrum Sepolia
USDC from <https://faucet.circle.com> (and a little Sepolia ETH if it funds the
sellers). Sellers need USDC + ETH only to register (`node fund-sellers.mjs` sends
them the registry fee and gas from the buyer).

## 1. Launch the sellers + register them

```bash
REGISTER=1 ./launch.sh                   # research + digest sellers
INVEST_AGENTS=1 REGISTER=1 ./launch.sh   # + the four investment agents
```

This starts the sellers, waits for health, then registers each. Registration
**mints an ERC-8004 identity** on the canonical Identity Registry for each seller
wallet that doesn't have one. Leave it running.

## 2. Run a buyer

```bash
npm run orchestrate -- "The state of AI agents and on-chain payments in 2026"
npm run invest                           # ETH/USDC paper-trading loop
```

You'll see the buyer discover the sellers (ranked by ⭐), pay each in USDC (with
an Arbiscan link), receive real output, and post reputation. With a ChainPe
indexer (`CHAINPE_INDEXER_URL`), the sellers' scores show as **verified** —
only reviews backed by a payment count.

The investment loop hires the price, news, analysis and DEX agents. Trades are
**paper trades** priced with the DEX agent's real Arbitrum One quote; only the
agent fees are real payments.

### All-in-one

```bash
REGISTER=1 ORCHESTRATE=1 TOPIC="..." ./launch.sh
./demo.sh                                # fund + register + run the investment demo
```

## Price, news and DEX sellers only (no API keys)

These three need no Anthropic key. Set `PRICE_/NEWS_/DEX_PAYTO` (and `*_AGENT_ID`
after registering) in `.env`, then:

```bash
npm run agents
```

The launcher restarts a seller that crashes or whose gateway stops answering 402.
That happens when the facilitator can't be reached at startup.

## Claude Desktop

`chainpe-mcp.mjs` exposes the marketplace as MCP tools (`discover`, `call_agent`,
`wallet_balance`, `rate_agent`, `payment_history`). For a full wallet with
budgets, use `packages/chainpe-wallet` instead.
