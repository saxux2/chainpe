# ChainPe — multi-surface agent examples

The **same** ChainPe discover + paid-fetch tools, driving two different agent
frameworks plus the CLI. This is the "it's infrastructure, not a Claude-only
app" proof: one payment + reputation core, many surfaces.

| Surface | Entry | Tools |
|---|---|---|
| Vercel AI SDK | `vercel-agent.ts` | `@chainpe/ai-tools/vercel` |
| LangChain (ReAct) | `langchain-agent.ts` | `@chainpe/ai-tools/langchain` |
| CLI (curl-level) | `chainpe fetch <url>` | `@chainpe/cli` → `@chainpe/sdk` |

All three settle USDC on Arbitrum (Sepolia by default) through the same `@chainpe/sdk` core.

## Setup

```bash
cp .env.example .env     # CHAINPE_PRIVATE_KEY + ANTHROPIC_API_KEY
npm install              # links the local @chainpe/* packages (build them first)
```

> Build the workspace packages once from the repo root so the `file:` links
> resolve: `npm install && npm run build`.

The paying wallet needs a little USDC: free Arbitrum Sepolia USDC from https://faucet.circle.com, or native USDC on Arbitrum One with `CHAINPE_NETWORK=arbitrum`. Gas is paid by the provider's facilitator.

## Run

```bash
# Vercel AI SDK agent
npm run vercel -- "Discover a service on ChainPe and call it"

# LangChain agent (same tools, same result)
npm run langchain -- "Discover a service on ChainPe and call it"

# CLI — no LLM needed
chainpe discover weather -n arbitrum-sepolia   # registry + x402 Bazaar + ERC-8004, ranked by ⭐
chainpe fetch -n arbitrum-sepolia https://your-service/endpoint   # auto-pays the 402 in USDC
```

To have something live to pay, run one of the sibling example APIs behind a
ChainPe proxy (`../weather-api/server.mjs` → `chainpe init/start`), or a seller
agent from `examples/seller-agents/`.
