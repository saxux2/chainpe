---
id: system-diagram
title: System Diagram
sidebar_position: 2
---

# System Diagram

Detailed component map of the ChainPe system, including data stores, external dependencies, and flow directions.

```mermaid
graph TB
    subgraph "Client Layer"
        AI["AI Agent\n(Node.js / Python / Claude)"]
        DEV["Developer App\n(@chainpe/sdk)"]
        MCP["Claude Desktop\nchainpe-wallet-mcp"]
    end

    subgraph "ChainPe NPM Packages"
        SDK["@chainpe/sdk\nChainPe class\nRegistryClient\nPolicyVaultClient\ndiscoverServices"]
        TOOLS["@chainpe/ai-tools\ncreateChainPeTools (Vercel)\ncreateChainPeLangChainTools"]
        CLICMD["@chainpe/cli\nchainpe init/start/register\nchainpe fetch/discover"]
    end

    subgraph "Provider"
        PROXY["x402 Proxy\nExpress + @x402/express\nPort 4402"]
    end

    subgraph "Facilitators"
        CDP["Coinbase CDP"]
        PAYAI["PayAI"]
        FAC["ChainPe facilitator\nservices/chainpe-facilitator\nPort 4500"]
    end

    subgraph "ChainPe Services (optional)"
        IDX["Indexer\nservices/chainpe-indexer\nPort 4600"]
        PG[("Postgres")]
    end

    BAZ["x402 Bazaar\n(Coinbase)"]

    subgraph "Arbitrum One (42161) / Arbitrum Sepolia (421614)"
        REG["ChainPeRegistry.sol\n(UUPS proxy)"]
        PV["PolicyVault.sol\n(UUPS proxy)"]
        IDNTY["ERC-8004 IdentityRegistry\n(canonical 0x8004A…)"]
        REPDB["ERC-8004 ReputationRegistry\n(canonical 0x8004B…)"]
        USDC["USDC\n0xaf88…5831 / 0x75fa…AA4d"]
    end

    AI --> SDK
    AI --> TOOLS
    AI --> CLICMD
    DEV --> SDK

    SDK -->|"x402 fetch (auto-pay 402)"| PROXY
    TOOLS -->|"chainpeFetch / discoverService"| PROXY
    CLICMD -->|"chainpe fetch <url>"| PROXY
    MCP -->|"x402_fetch"| PROXY

    PROXY -->|"/verify, /settle (failover)"| CDP & PAYAI & FAC
    CDP & PAYAI & FAC -->|"transferWithAuthorization"| USDC
    CDP -.->|"lists resource"| BAZ

    SDK -->|"search"| BAZ
    SDK -->|"getServices()"| REG
    SDK -->|"registration files"| IDNTY
    SDK -->|"GET /agents/:id/reputation"| IDX
    IDX --> PG
    IDX -->|"eth_getLogs (poll)"| REG
    IDX -->|"eth_getLogs (poll)"| REPDB

    SDK -->|"giveFeedback() + proof of payment"| REPDB
    SDK -->|"deposit(), setPolicy()"| PV

    CLICMD -->|"register()"| REG
    CLICMD -->|"IdentityRegistry.register()"| IDNTY
```

## Key data paths

### Happy-path payment (no PolicyVault)

```
Agent
  → cp.fetch(url)
  → GET url → 402 PAYMENT-REQUIRED { accepts: [...] }
  → sign EIP-3009 authorization (off-chain, no gas)
  → GET url + PAYMENT-SIGNATURE
  → Proxy: POST /verify to Facilitator (CDP / PayAI, failover)
  → Proxy: forward to Backend → 200
  → Proxy: POST /settle to Facilitator
  → Facilitator: USDC.transferWithAuthorization(agent→provider, amount)
  → Arbitrum: included in the next block (~250 ms)
  → Proxy: 200 + PAYMENT-RESPONSE { transaction: "0x..." }
  → Agent: receives PaidResult with txHash, posts feedback with proof of payment
```

### Happy-path payment (with PolicyVault)

```
Agent (session key)
  → PolicyVaultClient.signSpend(owner, to, amount)
  → returns SpendAuthorization { signature, nonce, deadline }

Relayer (any funded key)
  → PolicyVaultClient.relaySpend(auth)
  → PolicyVault.spend(owner, to, amount, deadline, sig)
  → [on-chain: verify sig, check all caps]
  → USDC.transfer(to, amount)
  → emit Spent(owner, to, amount, relayer, nonce)
```

### Discovery path (SDK)

```
Agent
  → cp.discover({ query: "weather", maxPrice: "0.05" })
  → in parallel:
      ChainPeRegistry.getServices(offset, 100) [paginated, when a registry is set]
      Coinbase Bazaar search (query or tags, up to 20 results)
      ERC-8004 registration files for known agent ids (endpoints probed for their 402 price)
  → de-duplicate by endpoint, filter by query/tags/maxPrice
  → reputation per agent: indexer /agents/:id/reputation (verified) or on-chain summary (unverified)
  → Returns: RankedService[] (scored first, highest score first)
```

### Discovery path (indexer REST)

```
Client
  → GET https://indexer/services?query=weather&maxPrice=0.05
  → Indexer: query over cached service + verified feedback rows
  → Returns: ranked list of services with reputation
```
