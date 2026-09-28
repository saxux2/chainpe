---
id: agent-integration
title: Agent Integration
sidebar_position: 4
---

# Agent Integration

This page covers integrating ChainPe into autonomous agents — systems that discover, pay for, and compose API services without human intervention.

## @chainpe/agent

The `@chainpe/agent` package provides a ready-made LLM agent that discovers and pays for x402 services. It runs on the Vercel AI SDK with Groq, OpenAI, Anthropic, Gemini or a local Ollama model, and has its own CLI (`chainpe-agent`).

### Installation

```bash
npm install @chainpe/agent
```

### Configuration

Run `chainpe-agent init` once. It writes `~/.chainpe/agent.json` (LLM, network, optional registry address) and stores the wallet key in the OS keychain. Then:

```ts
import { ChainPeAgent } from '@chainpe/agent'

const agent = await ChainPeAgent.fromConfig()

const result = await agent.run('Summarize the latest AI news', {
  maxSteps: 10,
  onPayment: (r) => console.log(`paid ${r.amount} ${r.token} → ${r.recipient}`)
})
console.log(result.text, result.payments.totalSpent.USDC)
```

The agent defaults to Arbitrum Sepolia, pays only in USDC/USDT0 on its network, refuses single payments above `payment.maxPricePerRequest` (10 USDC if unset), and posts ERC-8004 feedback with a proof of payment after each paid call.

### Available tools in the agent

The `@chainpe/agent` exposes these built-in tools:

| Tool | Description |
|---|---|
| `callPaidApi` | Call an x402-gated URL and auto-pay in USDC |
| `callFreeApi` | Call a free (non-402) URL |
| `discoverService` | Search the ChainPe registry, x402 Bazaar and ERC-8004 agents, ranked by reputation |

### Tool source files

- `packages/chainpe-agent/src/tools/callPaidApi.ts`
- `packages/chainpe-agent/src/tools/callFreeApi.ts`
- `packages/chainpe-agent/src/tools/discoverService.ts`

## chainpe-wallet-mcp (Claude Desktop)

The `chainpe-wallet-mcp` MCP extension gives Claude Desktop an Arbitrum x402 wallet (default: Arbitrum Sepolia). After building and installing it, Claude can:

1. Search the marketplace (`search_bazaar`)
2. Make paid API calls (`x402_fetch`)
3. Transfer USDC (`transfer_usdc`)
4. Check its balance (`check_balance`)
5. Post reputation feedback (`give_feedback`)
6. View spending reports (`spending_report`)

### MCP tools exposed

| Tool | Description |
|---|---|
| `search_bazaar` | Search the ChainPe registry, x402 Bazaar and ERC-8004 agents, ranked by reputation |
| `x402_fetch` | Fetch a URL, auto-paying the x402 402 in USDC |
| `pay` | Sign an x402 USDC payment authorization |
| `transfer_usdc` | Transfer USDC to another wallet |
| `transfer_eth` | Transfer ETH (gas) to another wallet |
| `check_balance` | Read USDC and ETH wallet balance |
| `give_feedback` | Post ERC-8004 feedback for a provider (optionally with `paymentTxHash` + `payTo` as proof) |
| `spending_report` | Summary of recent payments |
| `request_funding` | Generate an EIP-681 top-up link for USDC or ETH |

### Building the MCP extension

```bash
cd packages/chainpe-wallet
npm install
npm run build:mcpb  # produces chainpe.mcpb
```

Double-click `chainpe.mcpb` to install into Claude Desktop. See `packages/chainpe-wallet/README.md` for full setup.

## Pattern: buyer agent hiring seller agents

The seller-agent example in `examples/seller-agents/` demonstrates a buyer agent that discovers and hires two seller agents:

```bash
cd examples/seller-agents
cp .env.example .env   # fill in keys
npm install

# Launch the seller agents (in background)
./launch.sh

# Run the buyer agent
npm run orchestrate -- "summarize latest AI research"
```

The buyer agent:
1. Calls `discoverService` → gets ranked list with ERC-8004 scores
2. Calls the first seller agent (pays USDC) → gets partial result
3. Calls the second seller agent (pays USDC) → gets another result
4. Composes both results and returns the answer
5. Posts reputation feedback for both sellers (if `autoFeedback: true`)

Each seller agent:
- Runs behind the ChainPe x402 proxy
- Registers on `ChainPeRegistry` with an ERC-8004 identity
- Advertises its `agentId` on the 402 response

## Pattern: autonomous spending with PolicyVault

For long-running agents with controlled budgets:

```ts
import { PolicyVaultClient } from '@chainpe/sdk'

// Setup (done once by the operator)
const owner = new PolicyVaultClient({
  privateKey: process.env.OPERATOR_KEY!,
  network: 'arbitrum-sepolia',
  vaultAddress: process.env.POLICY_VAULT_ADDRESS
})
await owner.deposit('100.00')
await owner.setPolicy({
  sessionKey: '0xAgentSessionKey',
  maxPerCall: '0.10',
  dailyCap: '5.00',
  totalBudget: '100.00',
  expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
  allowlistOnly: false
})

// Agent loop (gasless)
const agent = new PolicyVaultClient({
  privateKey: process.env.AGENT_SESSION_KEY!,
  network: 'arbitrum-sepolia',
  vaultAddress: process.env.POLICY_VAULT_ADDRESS
})

// Agent signs (no gas) — relayer submits
const auth = await agent.signSpend({
  owner: '0xOperatorAddress',
  to: '0xProviderWallet',
  amount: '0.01'
})

// Relayer (could be the facilitator or any funded key)
const relayer = new PolicyVaultClient({
  privateKey: process.env.RELAYER_KEY!,
  network: 'arbitrum-sepolia',
  vaultAddress: process.env.POLICY_VAULT_ADDRESS
})
const txHash = await relayer.relaySpend(auth)
```
