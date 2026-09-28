# @chainpe/agent

[![npm](https://img.shields.io/npm/v/@chainpe/agent.svg)](https://www.npmjs.com/package/@chainpe/agent)

**Pre-built AI agent with x402 USDC payments on Arbitrum**

ChainPe Agent is an AI agent that can discover, pay for, and use monetized API
services. It runs on the Vercel AI SDK with Groq, OpenAI, Anthropic, Google Gemini
or a local Ollama model.

## Installation

```bash
npm install -g @chainpe/agent
```

Or as a library:

```bash
npm install @chainpe/agent
```

## Quick Start

### Prerequisites

1. **An LLM** — an API key (Groq has a free tier: https://console.groq.com/) or a
   local Ollama install.
2. **USDC on Arbitrum** — for testing, free Arbitrum Sepolia USDC from
   https://faucet.circle.com. Payments need no ETH: the provider's facilitator
   pays gas.
3. **A wallet** — import a private key or let `init` generate one.

### 1. Initialize configuration

```bash
chainpe-agent init
```

The wizard asks for:
- **LLM mode**: local (Ollama) or cloud API
- **LLM provider and model**, plus the API key
- **Network**: Arbitrum Sepolia (default) or Arbitrum One
- **Wallet**: import a private key or generate a new one. The key is stored in your
  OS keychain, never in the config file.
- **ChainPeRegistry address** (optional)

### 2. Check status

```bash
chainpe-agent status
```

### 3. Run tasks

```bash
chainpe-agent run "Find a weather service and get the weather for San Francisco"
```

## Commands

| Command | Description |
|---------|-------------|
| `chainpe-agent init` | Interactive setup wizard |
| `chainpe-agent status` | Show config and wallet balance |
| `chainpe-agent services` | List services registered on-chain |
| `chainpe-agent security` | Show security information and recommendations |
| `chainpe-agent run <task>` | Execute a task (`-p <service>` to pin a provider, `-v` for verbose) |

## Programmatic Usage

```typescript
import { ChainPeAgent } from "@chainpe/agent";

// Reads ~/.chainpe/agent.json and the key from the OS keychain
const agent = await ChainPeAgent.fromConfig();

const result = await agent.run(
  "Find a research service and summarize quantum computing",
  {
    maxSteps: 5,
    verbose: true,
    onPayment: (receipt) => {
      console.log(`Paid ${receipt.amount} ${receipt.token} to ${receipt.recipient}`);
    }
  }
);

console.log(result.text);
console.log(`Total spent: ${result.payments.totalSpent.USDC} USDC`);
```

The package also re-exports the SDK's `getReputation` and `giveFeedback`.

## How It Works

```
User Task → AI Agent → discoverService → callPaidApi (x402) → Response
                             ↓
       ChainPe registry · x402 Bazaar · ERC-8004 registrations (Arbitrum)
```

1. The agent receives a task.
2. `discoverService` searches the ChainPe registry, Coinbase's x402 Bazaar and
   ERC-8004 registration files, ranked by reputation.
3. It calls the chosen service and receives `402 Payment Required`.
4. It signs a USDC authorization (x402 v2, EIP-3009) and retries.
5. The service returns data; the agent posts ERC-8004 feedback with the
   settlement as proof of payment, then answers.

## Configuration

The agent stores config in `~/.chainpe/agent.json` (the private key lives in the
OS keychain):

```json
{
  "llm": {
    "mode": "api",
    "provider": "groq",
    "model": "qwen/qwen3-32b",
    "apiKey": "gsk_..."
  },
  "wallet": {
    "address": "0xYOUR_ADDRESS",
    "useKeychain": true
  },
  "payment": {
    "preferredToken": "USDC"
  },
  "network": "arbitrum-sepolia",
  "registryAddress": "0x…"
}
```

For a local model, use `"mode": "local"`, `"provider": "openai"`,
`"apiKey": "ollama"` and `"baseURL": "http://localhost:11434/v1"`.

| Field | Notes |
|---|---|
| `network` | `arbitrum-sepolia` (default) or `arbitrum` |
| `registryAddress` | ChainPeRegistry; also read from `CHAINPE_REGISTRY_ADDRESS`. Without it, discovery uses the Bazaar and ERC-8004 only. |
| `reputationRegistry` | Defaults to the canonical ERC-8004 Reputation Registry |

The agent pays only in USDC or USDT0 on its configured network and refuses any
single payment above 10 USDC. Set `CHAINPE_INDEXER_URL` to rank services by
payment-verified reputation.

## Supported LLMs

Groq, OpenAI, Anthropic, Google Gemini, and any local model served by Ollama.

- **Groq**: https://console.groq.com/
- **OpenAI**: https://platform.openai.com/api-keys
- **Anthropic**: https://console.anthropic.com/
- **Google AI**: https://aistudio.google.com/app/apikey

## Requirements

- Node.js >= 18
- An LLM API key or a local Ollama install
- USDC on Arbitrum Sepolia (testnet) or Arbitrum One

## License

MIT
