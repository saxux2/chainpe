---
id: installation
title: Installation
sidebar_position: 3
---

# Installation

ChainPe is a monorepo. Most users only need one or two packages. Install exactly what you need.

## Core SDK

The primary package for making x402 payments and reading/writing ERC-8004 reputation:

```bash
npm install @chainpe/sdk
# or
pnpm add @chainpe/sdk
```

**Dependencies:** `viem` and the x402 v2 packages (`@x402/core`, `@x402/evm`, `@x402/extensions`) install with it.

**Node version:** 18+ required (uses native `fetch`, top-level await in examples).

## AI Framework Tools

Vercel AI SDK and LangChain tool adapters — drop-in `chainpeFetch` and `discoverService` tools:

```bash
npm install @chainpe/ai-tools
```

If using the Vercel AI SDK adapter:
```bash
npm install ai @ai-sdk/anthropic   # or @ai-sdk/openai, etc.
```

If using the LangChain adapter:
```bash
npm install @langchain/core @langchain/langgraph
```

## CLI

The provider proxy and consumer command-line tool:

```bash
npm install -g @chainpe/cli
# then
chainpe --help
```

Or use it without installing globally:
```bash
npx @chainpe/cli discover
npx @chainpe/cli fetch <url>
```

## Standalone Agent SDK

The `@chainpe/agent` package provides a self-contained LLM agent loop that discovers and pays for services:

```bash
npm install @chainpe/agent
```

## Claude Desktop wallet (MCP)

The `chainpe-wallet-mcp` package gives Claude Desktop an Arbitrum x402 wallet with 9 tools. Install it as a `.mcpb` extension built from the repo (`npm run build:mcpb`), or point any MCP client at `npx -y chainpe-wallet-mcp`. See the [README](https://github.com/saxux2/chainpe/tree/main/packages/chainpe-wallet) for build and install instructions.

## Environment variables

All packages read from environment variables. The minimum set for making payments:

```bash
# Your EOA private key — signs EIP-3009 USDC authorizations
CHAINPE_PRIVATE_KEY=0x...

# Target network (CLI): arbitrum-sepolia (testnet) or arbitrum (Arbitrum One)
CHAINPE_NETWORK=arbitrum-sepolia

# Your ChainPeRegistry deployment (optional — only for registry discovery)
CHAINPE_REGISTRY_ADDRESS=0x...

# Optional: payment-verified reputation from a ChainPe indexer
CHAINPE_INDEXER_URL=https://...
```

The ERC-8004 registries default to the canonical addresses and need no configuration. `ARBITRUM_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` override the public RPCs.

Copy `.env.example` from the repo root and fill in your values. Never commit a `.env` file with real keys.

## TypeScript configuration

The SDK ships full TypeScript types. It uses ES module output, so ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  }
}
```

Or if using CommonJS in your project, use a dynamic import:

```ts
const { ChainPe } = await import('@chainpe/sdk')
```
