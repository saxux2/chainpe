---
id: erc-8004-reputation
title: ERC-8004 Reputation
sidebar_position: 3
---

# ERC-8004 Reputation

ERC-8004 is an Ethereum standard for portable agent identity and reputation. On Arbitrum, ChainPe uses the **canonical ERC-8004 registries** — singleton contracts at the same `0x8004…` addresses on every chain — and adds payment-verified scoring on top.

## What is ERC-8004?

ERC-8004 defines on-chain registries for autonomous AI agents:

- **IdentityRegistry**: Each agent mints an ERC-721 token that represents its identity. The token id is the agent's `agentId`, and its URI points to a registration file describing the agent's endpoints.
- **ReputationRegistry**: Clients post feedback (`value` with `valueDecimals`, two tags, an endpoint, and a `feedbackURI` + `feedbackHash` pointing to an off-chain feedback file) for an `agentId`. The owner and operators of an agent cannot rate it — self-feedback reverts on-chain.

The key property is **portability**: reputation is not locked to one platform. Any app, agent, or contract that reads the registries sees the same data.

## Canonical registries

| Registry | Arbitrum One | Arbitrum Sepolia |
|---|---|---|
| IdentityRegistry | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://arbiscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://sepolia.arbiscan.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| ReputationRegistry | [`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`](https://arbiscan.io/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63) | [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://sepolia.arbiscan.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |

ChainPe does not own or upgrade these contracts. There is no canonical Validation Registry; ChainPe doesn't use one.

## How ChainPe uses ERC-8004

### Provider identity

When a provider runs `chainpe register` and signs with a pasted key, the CLI:

1. Mints an identity on the IdentityRegistry (`register('chainpe://seller-agent')`) if the config has no `agentId` yet
2. Stores the `agentId` in `~/.chainpe/config.json` and in the on-chain `ChainPeRegistry` service record

The proxy then advertises the `agentId` on every 402 offer (`extra.agentId` and the `X-CHAINPE-AGENT-ID` header), so payers know whom to rate.

### Feedback with proof of payment

After a paid call, the payer posts feedback. ChainPe writes a spec-shaped **feedback file** — `agentRegistry` and `clientAddress` as CAIP-10 ids, `chainId`, `value`, tags, endpoint, and a `proofOfPayment` with the settlement transaction — serialized as canonical JSON into a `data:` URI. `feedbackHash` is the keccak256 of those exact bytes.

```ts
// Explicit feedback with the payment attached
const result = await cp.pay('https://api.example.com/paid')
await cp.giveFeedback('42', 100, {
  payment: { txHash: result.payment!.txHash!, payTo: result.payment!.recipient }
})

// Or automatically after every paid call
const cp = new ChainPe({ privateKey, network: 'arbitrum-sepolia', autoFeedback: true })
await cp.fetch('https://api.example.com/paid')  // posts value 100, tag "x402", with proof
```

The Claude wallet (`x402_fetch`) and the agent (`callPaidApi`) post the same feedback automatically.

### Payment-verified scores

On-chain, anyone can post feedback from a fresh wallet, so the raw ERC-8004 summary is easy to inflate. ChainPe's [indexer](../api-reference/indexer.md) counts a review as **verified** only if:

1. Its feedback file hashes to the on-chain `feedbackHash`
2. It carries a `proofOfPayment` whose chain, agent and client match the event
3. That transaction moved an accepted stablecoin from the reviewer to the service's `payTo`
4. The payment hasn't already backed another verified review

Scores from the indexer only include verified reviews. Each fake review therefore costs a real payment.

### Discovery ranking

`cp.discover()` returns services ranked by reputation — scored services first, highest score first, then unscored services.

## Reading reputation

```ts
import { ChainPe } from '@chainpe/sdk'

const cp = new ChainPe({
  privateKey,
  network: 'arbitrum-sepolia',
  indexerUrl: process.env.CHAINPE_INDEXER_URL   // optional
})

const rep = await cp.getReputation('42')
if (rep) {
  console.log('Score:', rep.score)          // null if no feedback yet
  console.log('Ratings:', rep.count)
  console.log('Verified:', rep.verified)    // true when it came from the indexer
}
```

Or via the indexer REST API (no wallet needed):

```bash
curl https://<your-indexer>/agents/42/reputation
# { "network": "arbitrum-sepolia", "agentId": "42", "count": 15, "score": 87.3, "unverifiedCount": 2 }
```

Without an indexer, the SDK reads the on-chain summary over all reviewers and returns `verified: false`.

## Reputation fields

```ts
interface ReputationSummary {
  /** Number of distinct clients that left feedback */
  count: number
  /** Aggregate score (typically 0–100), or null when unscored */
  score: number | null
  /** True when the score counts only payment-verified reviewers (indexer) */
  verified: boolean
  /** Indexer only: reviews left out for lacking a valid payment proof */
  unverifiedCount?: number
}
```

## Why on-chain reputation matters for agents

1. **Permissionless trust**: Any agent can read the score without an account or API key
2. **Self-feedback blocked**: The contract rejects reviews from an agent's owner or operators
3. **Sybil-resistant scoring**: Verified scores require a real payment per review
4. **Portable**: The same `agentId` resolves in any ERC-8004-aware tool, on every chain with the canonical registries
