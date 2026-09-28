---
id: sdk-reference-agent
title: "@chainpe/agent"
sidebar_position: 4
---

# @chainpe/agent

A ready-made LLM agent that discovers and pays for x402 services on Arbitrum. Built on the Vercel AI SDK (Groq, OpenAI, Anthropic, Gemini, or local Ollama).

## Installation

```bash
npm install @chainpe/agent        # library
npm install -g @chainpe/agent     # CLI: chainpe-agent
```

## Key exports

```ts
export { ChainPeAgent, createAgent } from './agent.js'
export { PaymentClient, createPaymentClient } from './payment.js'
export { ServiceDiscovery } from './discovery.js'
export { loadConfig, saveConfig, saveWalletToKeychain, addressFromPrivateKey /* … */ } from './config.js'
export { savePrivateKey, getPrivateKey, isKeychainAvailable /* … */ } from './keychain.js'
export { createWalletFromPrivateKey, getWalletBalance, formatBalance /* … */ } from './wallet.js'
export { createDiscoverServiceTool, createCallPaidApiTool, createCallFreeApiTool } from './tools/index.js'
// Re-exported from @chainpe/sdk:
export { RegistryClient, getReputation, giveFeedback, submitPaidCallFeedback, resolveReputationRegistry } from '@chainpe/sdk'
```

## ChainPeAgent

The agent reads its config from `~/.chainpe/agent.json` (written by `chainpe-agent init`) and its wallet key from the OS keychain.

```ts
import { ChainPeAgent } from '@chainpe/agent'

const agent = await ChainPeAgent.fromConfig()

const result = await agent.run('Find a weather API and get conditions in Paris', {
  maxSteps: 10,
  verbose: false,
  onStep: (step) => console.log(step.toolName),
  onPayment: (receipt) => console.log(receipt.amount, receipt.token, receipt.txId)
})

result.text                      // final answer
result.payments.totalSpent.USDC  // human USDC string
result.payments.receipts         // PaymentReceipt[]
```

Or pass the config directly with `new ChainPeAgent({ config })` (the key for `config.wallet.address` must be in the keychain — see `saveWalletToKeychain`).

`AgentConfig`:

```ts
{
  llm: { mode?: 'api' | 'local'; provider: 'openai' | 'anthropic' | 'gemini' | 'groq'; model: string; apiKey?: string; baseURL?: string }
  wallet: { address: string; useKeychain?: boolean }
  payment: { preferredToken: 'USDC' }
  network?: 'arbitrum' | 'arbitrum-sepolia'   // default 'arbitrum-sepolia'
  registryAddress?: string
  reputationRegistry?: string
  registryPath?: string
}
```

## Built-in tools

### discoverService

Searches the ChainPe registry, Coinbase's x402 Bazaar and ERC-8004 registration files, ranked by reputation. Source: `src/tools/discoverService.ts`.

```ts
// Input
{ query?: string; tags?: string[]; maxPrice?: string; paymentToken?: string }
```

### callPaidApi

Calls a discovered service by name, paying its 402 in USDC, then posts ERC-8004 feedback with the settlement as proof of payment. Source: `src/tools/callPaidApi.ts`.

```ts
// Input
{ serviceName: string; path?: string; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: Record<string, unknown> }
```

### callFreeApi

Calls a URL that needs no payment. Source: `src/tools/callFreeApi.ts`.

```ts
// Input
{ url: string; method?: string; headers?: Record<string, string>; body?: Record<string, unknown> }
```

## PaymentClient

Direct x402 payments without the agent loop:

```ts
import { PaymentClient } from '@chainpe/agent'

const client = new PaymentClient({
  privateKey,
  network: 'arbitrum-sepolia',
  maxPerPayment: '0.10'           // default "10"
})
const res = await client.fetch('https://api.example.com/data')
console.log(res.status, res.data, res.paid, res.paymentReceipt)
```

It pays only offers on its network in USDC or USDT0, never above `maxPerPayment`.

## Wallet helpers

```ts
import { getWalletBalance, formatBalance } from '@chainpe/agent'

const balance = await getWalletBalance('0xAddress', 'arbitrum-sepolia')
console.log(formatBalance(balance))   // { eth: "0.01", usdc: "20.0" }
```

## CLI

```bash
chainpe-agent init                     # LLM, network, wallet (stored in the OS keychain)
chainpe-agent status                   # config + balances
chainpe-agent services                 # services registered on-chain
chainpe-agent run "summarize the latest AI research" [-p <service>] [-v]
```
