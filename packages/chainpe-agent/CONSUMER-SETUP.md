# ChainPe Consumer Developer Setup

**Build AI agents that autonomously discover, pay for, and use monetized APIs with USDC on Arbitrum.**

---

## 🚀 5-Minute Setup

### Step 1: Install ChainPe Agent

```bash
npm install -g @chainpe/agent
```

Or use it as a library in your project:

```bash
npm install @chainpe/agent
```

### Step 2: Get an LLM API key

**Groq** has a free tier with fast inference:

1. Visit https://console.groq.com/
2. Create an API key (starts with `gsk_...`)

Alternatives:
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/
- Google AI: https://aistudio.google.com/app/apikey
- Local Ollama: https://ollama.com/ (no key needed)

### Step 3: Get test USDC

Start on **Arbitrum Sepolia**, where USDC is free:

1. Use any EVM wallet, or let `chainpe-agent init` generate one.
2. Get Arbitrum Sepolia USDC from https://faucet.circle.com.

Paying needs **no ETH**: you sign a USDC authorization and the provider's
facilitator submits it and pays the gas. For Arbitrum One, send real USDC to the
same address on Arbitrum (native USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`).

### Step 4: Initialize your agent

```bash
chainpe-agent init
```

```
? LLM Mode › API (OpenAI/Anthropic/Gemini/Groq)
? LLM Provider › Groq
? Model › qwen/qwen3-32b
? groq API Key › gsk_...
? Arbitrum network › Arbitrum Sepolia (testnet)
? Wallet › Import an existing private key
? Wallet private key (0x…) › ********
? ChainPe Registry contract address (optional) › 0x…
```

The private key is stored in your OS keychain, never in `~/.chainpe/agent.json`.

### Step 5: Test your agent

```bash
chainpe-agent run "Get weather for London"
```

The agent searches for a weather service, pays its 402 in USDC, and prints the
answer with a payment summary (transactions and total USDC spent). 🎉

---

## 📖 CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `chainpe-agent init` | Interactive setup wizard | `chainpe-agent init` |
| `chainpe-agent status` | Show config, wallet balance | `chainpe-agent status` |
| `chainpe-agent services` | List services registered on-chain | `chainpe-agent services` |
| `chainpe-agent security` | Keychain and safety information | `chainpe-agent security` |
| `chainpe-agent run <task>` | Execute a task | `chainpe-agent run "analyze data"` |
| `chainpe-agent run <task> --provider <name>` | Use a specific service | `chainpe-agent run "get weather" --provider Weather` |
| `chainpe-agent run <task> --verbose` | Show tool calls and payments | `chainpe-agent run "task" --verbose` |

---

## 💻 SDK Usage (Programmatic)

Run `chainpe-agent init` once so the config and keychain entry exist, then:

### Basic usage

```typescript
import { ChainPeAgent } from "@chainpe/agent";

const agent = await ChainPeAgent.fromConfig();

const result = await agent.run("Get weather for Tokyo");

console.log(result.text);
console.log(`Spent: ${result.payments.totalSpent.USDC} USDC`);
```

### With options

```typescript
import { ChainPeAgent } from "@chainpe/agent";

const agent = await ChainPeAgent.fromConfig();

const result = await agent.run(
  "Find a research service and summarize quantum computing",
  {
    maxSteps: 10,
    verbose: true,
    onPayment: (receipt) => {
      console.log(`💰 Paid ${receipt.amount} ${receipt.token} to ${receipt.service}`);
      if (receipt.txId) console.log(`   https://sepolia.arbiscan.io/tx/${receipt.txId}`);
    },
    onStep: (step) => {
      if (step.toolName) console.log(`🔧 ${step.toolName}`);
    }
  }
);

console.log("Response:", result.text);
console.log("Steps taken:", result.steps.length);
console.log("Payments:", result.payments.transactionCount);
console.log("USDC spent:", result.payments.totalSpent.USDC);
```

### Passing config in code

```typescript
import { ChainPeAgent, saveWalletToKeychain, addressFromPrivateKey } from "@chainpe/agent";

const privateKey = process.env.CHAINPE_PRIVATE_KEY!;
const address = addressFromPrivateKey(privateKey);
await saveWalletToKeychain(address, privateKey); // the agent reads keys from the keychain

const agent = new ChainPeAgent({
  config: {
    llm: {
      mode: "api",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: process.env.GROQ_API_KEY!
    },
    wallet: { address, useKeychain: true },
    payment: { preferredToken: "USDC" },
    network: "arbitrum-sepolia",
    registryAddress: process.env.CHAINPE_REGISTRY_ADDRESS
  }
});

const result = await agent.run("Get weather data");
```

### Discovering services directly

```typescript
import { ServiceDiscovery } from "@chainpe/agent";

const discovery = new ServiceDiscovery({ network: "arbitrum-sepolia" });
const services = await discovery.search({ query: "weather" });

for (const s of services) {
  console.log(`${s.name}: ${s.pricePerRequest} ${s.paymentToken} → ${s.endpoint}`);
}
```

Discovery merges the ChainPe registry (when an address is configured), Coinbase's
x402 Bazaar and ERC-8004 registration files, ranked by reputation.

---

## 🔧 Configuration Reference

### Config file location

`~/.chainpe/agent.json`

### Config structure

```typescript
{
  llm: {
    mode: "api" | "local",            // Cloud API or local Ollama
    provider: "groq" | "openai" | "anthropic" | "gemini",
    model: string,
    apiKey?: string,                  // Not needed for local
    baseURL?: string                  // e.g. http://localhost:11434/v1 for Ollama
  },
  wallet: {
    address: string,                  // 0x…; the key lives in the OS keychain
    useKeychain?: boolean
  },
  payment: {
    preferredToken: "USDC"
  },
  network?: "arbitrum-sepolia" | "arbitrum",   // default arbitrum-sepolia
  registryAddress?: string,           // ChainPeRegistry (or CHAINPE_REGISTRY_ADDRESS)
  reputationRegistry?: string,        // default: canonical ERC-8004 registry
  registryPath?: string               // local registry cache
}
```

The agent pays only in USDC or USDT0 on its configured network and refuses any
single payment above `payment.maxPricePerRequest` in `agent.json` (10 USDC if unset).

---

## 🎯 Example: batch queries

```typescript
// weather-agent.ts
import { ChainPeAgent } from "@chainpe/agent";

const agent = await ChainPeAgent.fromConfig();

for (const city of ["London", "Paris", "Tokyo"]) {
  const result = await agent.run(`Get current weather for ${city}`);
  console.log(result.text);
  console.log(`💰 Spent: ${result.payments.totalSpent.USDC} USDC`);
}
```

```bash
npx tsx weather-agent.ts
```

---

## 🔐 Security Best Practices

### Wallet security

1. **Never commit your private key.** `chainpe-agent init` stores it in the OS keychain.
2. **Use a dedicated wallet** with only the USDC the agent should spend.
3. **Test on Arbitrum Sepolia first**, then set `network: "arbitrum"`.
4. **Watch the balance**: `chainpe-agent status`, or the address on arbiscan.io.

### API key security

1. **Never commit API keys.**
2. **Rotate keys regularly.**
3. **Set spending limits** on your LLM provider's dashboard.

---

## 🐛 Troubleshooting

### "API key is invalid"
- Check the key and that it matches the chosen provider.

### "Wallet private key not found in OS keychain"
- Run `chainpe-agent init` again, or store it with `saveWalletToKeychain()`.
- `chainpe-agent security` shows whether the OS keychain is available.

### "Invalid private key"
- An EVM key is `0x` followed by 64 hex characters.

### "Insufficient balance"
- Testnet: get USDC from https://faucet.circle.com (Arbitrum Sepolia).
- Mainnet: send USDC on Arbitrum One to the agent's address.
- Check with `chainpe-agent status`.

### "Service not found"
- Try a broader task so discovery can search, or drop `--provider`.
- Set `registryAddress` to include ChainPe-registered services.

### "Payment failed"
- Check the service charges on the same network as your agent.
- Check the price is within `payment.maxPricePerRequest` (10 USDC if unset).

---

## 📚 Next Steps

1. **Build your first agent** with simple queries on Arbitrum Sepolia.
2. **Explore services** with `chainpe-agent services` or `chainpe discover`.
3. **Combine services** into multi-step workflows.
4. **Switch to Arbitrum One** when ready.

## 🤝 Need Help?

- **Documentation**: https://github.com/saxux2/chainpe
- **Issues**: https://github.com/saxux2/chainpe/issues
