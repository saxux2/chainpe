# Project Structure

```
chainpe/
├── contracts/              Smart contracts (Hardhat, Solidity 0.8.28)
│   ├── contracts/
│   │   ├── ChainPeRegistry.sol        Service registry (UUPS proxy)
│   │   ├── PolicyVault.sol            Gasless agent spending vault (UUPS proxy)
│   │   ├── governance/                ChainPeTimelock (mainnet owner)
│   │   ├── erc8004/                   Reference ERC-8004 registries (tests only;
│   │   │                              live networks use the canonical 0x8004… ones)
│   │   └── mocks/                     Test-only mocks
│   ├── scripts/                       Deploy, verify, ownership + preflight scripts
│   ├── test/                          86 tests + an Arbitrum One fork test
│   └── deployments/                   Deployed addresses per network
│                                      (archive-avalanche/ holds the old records)
│
├── packages/
│   ├── chainpe/              Provider SDK + CLI (@chainpe/cli)
│   │   └── src/
│   │       ├── cli.ts                 `chainpe init/start/register/fetch/discover`
│   │       ├── registry.ts            On-chain registration via viem
│   │       └── proxy/                 @x402/express v2 proxy, facilitator failover
│   │                                  (CDP → PayAI), Bazaar discovery metadata
│   │
│   ├── chainpe-agent/        Consumer agent SDK (@chainpe/agent)
│   │   └── src/
│   │       ├── agent.ts               Autonomous AI agent (discover → pay → use)
│   │       ├── discovery.ts           Merged discovery via the SDK
│   │       └── tools/                 AI tool definitions
│   │
│   ├── chainpe-sdk/          Core SDK (@chainpe/sdk): payments, discovery,
│   │                         reputation, PolicyVault; networks.ts is the single
│   │                         chain-config table for every package
│   ├── chainpe-ai-tools/     Vercel AI SDK + LangChain tools (@chainpe/ai-tools)
│   └── chainpe-wallet/       MCP wallet server for Claude (chainpe-wallet-mcp)
│       └── scripts/build-mcpb.sh      Builds .mcpb for Claude Desktop
│
├── services/
│   ├── chainpe-facilitator/  Non-custodial x402 v2 facilitator, multi-network
│   └── chainpe-indexer/      Event indexer + REST API (Postgres), verifies
│                             payment proofs on feedback
│
├── apps/
│   ├── dashboard/            Next.js marketplace dashboard
│   └── landing/              Landing page + docs (fumadocs, content/docs)
│
├── examples/
│   ├── weather-api/          Zero-dependency weather backend
│   ├── weather-railway/      Railway-deployable weather backend
│   ├── proxy-railway/        Railway-deployable x402 proxy
│   ├── seller-agents/        Multi-agent marketplace: Arbitrum price/news/analysis/DEX sellers
│   ├── arbitrum-bench/       Block time, gas price + a measured x402 settlement
│   ├── agent-surfaces/       LangChain + Vercel AI SDK integrations
│   └── policy-vault/         PolicyVault gasless spending demo
│
├── docs/
│   ├── CHANGELOG.md
│   ├── DEPLOYMENTS.md        Live contract addresses
│   ├── IMPLEMENTATION-GUIDE.md  Remaining migration work, by phase
│   ├── STRUCTURE.md          This file
│   └── WHY-ARBITRUM.md       Why ChainPe runs on Arbitrum
│
└── e2e/                      local.test.mjs (Hardhat, runs in npm test) + live scripts
                              for Arbitrum Sepolia and Arbitrum One
```
