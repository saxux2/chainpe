---
id: faq
title: FAQ
sidebar_position: 10
---

# Frequently Asked Questions

## General

### What is ChainPe?

ChainPe is payment + reputation infrastructure for AI agents on Arbitrum. It lets providers monetize any HTTP API per call in USDC (via the x402 protocol), and lets AI agents discover, pay for, and rate those services autonomously.

### Is ChainPe custodial?

No. Facilitators (Coinbase CDP, PayAI, or ChainPe's own) are non-custodial. They only relay payer-signed USDC authorizations (EIP-3009) and cannot redirect or steal funds. They pay the ETH gas. Payer USDC goes directly from the payer's wallet to the provider's wallet.

### What blockchain does ChainPe use?

Arbitrum One (mainnet) and Arbitrum Sepolia (testnet). Arbitrum has ~250 ms blocks, fees of a fraction of a cent per settlement, native Circle USDC with EIP-3009, two hosted x402 facilitators, the canonical ERC-8004 registries and Coinbase's x402 Bazaar. See `docs/WHY-ARBITRUM.md` in the repository for the rationale.

### Is this just for Claude/AI?

No. Claude/MCP is one client. The same payment core drives an SDK (`@chainpe/sdk`), Vercel AI SDK tools, LangChain tools, a CLI, and a standalone agent SDK. Any application that can make HTTP requests can use ChainPe.

---

## Payments

### Does the agent need ETH for gas?

No. The facilitator pays ETH gas when it settles the payment. The agent only needs USDC. It needs ETH only for its own transactions, such as posting feedback.

### What is the minimum payment amount?

There is no minimum set in the protocol. In practice, the minimum meaningful amount is 0.000001 USDC (1 atomic unit, 6 decimals). Registration fees and service prices are set by the provider. The registry's default registration fee is 1 USDC.

### How fast is settlement?

The facilitator's transaction is included in the next Arbitrum block (~250 ms) and confirmed by the sequencer; it is final on Ethereum once its batch is posted.

### What if the facilitator goes down?

The proxy tries its facilitators in order (by default CDP then PayAI on Arbitrum One) and moves to the next when one is unreachable. If all are down, the agent gets a `402` and can retry. Providers can add their own `services/chainpe-facilitator` to the list or settle in-process with `chainpe start --facilitator <key>`.

### Which tokens can I pay with?

USDC on both networks, and USDT0 on Arbitrum One. Both support EIP-3009. ChainPe payers refuse any other asset, so a 402 asking for an unknown token fails instead of paying something unexpected.

### What is EIP-3009?

EIP-3009 (`transferWithAuthorization`) is a standard for gasless USDC transfers. The token holder signs a message off-chain authorizing a specific transfer (amount, recipient, validity window). A third party submits the signed message on-chain. This is how agents pay without holding ETH.

---

## Registry

### How much does it cost to register a service?

The deploy default is **1 USDC** to register and **0 USDC** to update. The owner can change them with `setRegistrationFee()` / `setUpdateFee()`; read `registrationFee()` for the live value. Registering also costs a little ETH for gas.

### Can I update my service listing after registering?

Yes. Call `chainpe register` again (the CLI detects an existing listing and calls `update()`), or call `ChainPeRegistry.update(ServiceInput)` directly. Updates are currently free (update fee is 0 USDC).

### What is the service key?

Each service is identified by `keccak256(abi.encode(developer, name))`. This is a `bytes32` storage key. The indexer also uses `developer:name` as a human-readable id (e.g. `0xAbc...:My Service`).

### Can multiple providers have the same service name?

Yes — the key includes the developer address. `0xAlice:Weather` and `0xBob:Weather` are distinct listings.

---

## ERC-8004 Reputation

### What is ERC-8004?

An Ethereum standard for portable agent identity and reputation. An IdentityRegistry mints NFT identities; a ReputationRegistry stores feedback from counterparties. ChainPe uses the canonical registries deployed at the same `0x8004…` addresses on every chain.

### Can providers inflate their own reputation?

The ReputationRegistry blocks feedback from an agent's owner and operators on-chain. A provider could still use other wallets as fake buyers, so ChainPe's indexer counts only reviews that carry a verified proof of payment to the service, one review per payment. Faking a score therefore costs real payments. Without an indexer, the SDK marks scores `verified: false`.

### Is ERC-8004 finalized?

It is still a draft EIP, but the registries are deployed as shared singletons (version 2.0.0 on Arbitrum One). ChainPe follows the deployed ABI and the spec's feedback-file format.

### What does a reputation score of 100 mean?

Feedback carries a value (ChainPe uses 0–100). 100 is the maximum positive rating and is what `autoFeedback` posts after a successful paid call. The aggregate `score` in `ReputationSummary` is the mean of the counted feedback.

---

## PolicyVault

### Who pays gas for PolicyVault `spend()` calls?

The relayer — anyone who calls `PolicyVault.spend()`. The agent only signs the authorization off-chain. This is why agents can operate gaslessly even with PolicyVault.

### What happens if the session key leaks?

Call `revokeSession()` immediately from the owner wallet. After revocation, all future `spend()` calls with that session key revert with `"session inactive"`. The session key cannot move more than the policy allows — an attacker with the session key cannot exceed caps or pay unapproved recipients.

### Can I have multiple active sessions?

No. Each owner has one active `Policy`. Calling `setPolicy()` again replaces the current policy and resets `totalSpent` to zero.

---

## Development

### How do I run the tests?

```bash
# Workspace tests (SDK, ai-tools, etc.)
npm test

# Contract tests (86 tests + Arbitrum One fork test)
cd contracts && npm test
```

### Does ChainPe work with OpenAI models?

Yes. `@chainpe/ai-tools` wraps the ChainPe SDK as framework-native tools, not model-native tools. The LangChain adapter works with any `ChatModel` including `ChatOpenAI`. The Vercel AI SDK adapter works with any provider that supports tool use.

### Can I run ChainPe completely locally?

Yes. Use:
1. `chainpe start --facilitator <key>` — in-process facilitator (no hosted facilitator needed)
2. The SDK reads the registry and reputation from the chain directly
3. Skip the indexer: use `RegistryClient.listAllServices()` which reads on-chain

For a fully local environment, deploy `MockUSDC` and `ChainPeRegistry` to a local Hardhat node.

### What's the npm scope?

Published packages use the `@chainpe` scope: `@chainpe/sdk`, `@chainpe/ai-tools`, `@chainpe/agent`, `@chainpe/cli`. Earlier releases were published as `@chainpeavax/*`.
