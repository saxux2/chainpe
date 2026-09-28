# @chainpe/sdk

[![npm](https://img.shields.io/npm/v/@chainpe/sdk.svg)](https://www.npmjs.com/package/@chainpe/sdk)

**x402 USDC payments + on-chain ERC-8004 reputation for the Arbitrum agent economy — in 3 lines.**

Give any app or AI agent the ability to **discover, pay for, and rate** HTTP APIs
per request in USDC, settled on Arbitrum. The provider's facilitator pays the gas,
so your wallet only needs USDC.

```bash
npm install @chainpe/sdk
```

## Quickstart (the 3 lines)

```ts
import { ChainPe } from '@chainpe/sdk'

const cp = new ChainPe({ privateKey: process.env.PRIVATE_KEY!, network: 'arbitrum-sepolia' })
const res = await cp.fetch('https://api.example.com/paid') // auto-pays a 402
const data = await res.json()
```

`cp.fetch` is a drop-in `fetch`: it makes the request, and if the server answers
`402 Payment Required`, it signs a USDC payment (EIP-3009, x402 v2), retries with
the `PAYMENT-SIGNATURE` header, and returns the final `Response`.

Test USDC for Arbitrum Sepolia comes from https://faucet.circle.com. Drop
`network` (or pass `'arbitrum'`) to pay real USDC on Arbitrum One.

## Discover + pay an agent (ranked by reputation)

```ts
const cp = new ChainPe({ privateKey, network: 'arbitrum-sepolia' })

// Searches the ChainPe registry, Coinbase's x402 Bazaar and ERC-8004
// registration files. Ranked: scored services first, highest ⭐ first.
const services = await cp.discover('summarize')

const best = services[0]
const result = await cp.pay(best.endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '…' }),
  autoFeedback: true // leave on-chain ERC-8004 feedback after paying
})

console.log(result.data)        // parsed response body
console.log(result.payment)     // { amount, token, recipient, network, txHash }
console.log(result.reputation)  // { agentId, score, txHash } when autoFeedback
```

## API

`new ChainPe(options)`

| option | default | purpose |
|---|---|---|
| `privateKey` | — (required) | EOA key that signs payments + feedback |
| `network` | `'arbitrum'` | `'arbitrum'` (Arbitrum One) or `'arbitrum-sepolia'` |
| `registryAddress` | `CHAINPE_REGISTRY_ADDRESS` | ChainPeRegistry address (only for registry discovery) |
| `reputationRegistry` | canonical ERC-8004 registry | ERC-8004 Reputation Registry |
| `maxPerCall` | `'1'` | max USDC to auto-pay for one 402 |
| `autoFeedback` | `false` | post positive feedback after a paid call |
| `indexerUrl` | `CHAINPE_INDEXER_URL` | ChainPe indexer for payment-verified reputation |
| `facilitatorUrl` | — | deprecated, unused (the provider picks the facilitator) |

Methods:

- **`fetch(url, opts?)` → `Response`** — drop-in fetch that auto-pays a 402.
- **`pay(url, opts?)` → `PaidResult`** — same, but returns parsed `data` plus
  `payment` and (optional) `reputation` details.
- **`discover(query?)` → `RankedService[]`** — merged discovery over the ChainPe
  registry, the x402 Bazaar and ERC-8004 registration files, de-duplicated by
  endpoint, annotated with reputation and ranked best-first. `query` is a search
  string or `{ query, tags, maxPrice, sources, agentIds }`.
- **`getReputation(agentId)` → `ReputationSummary | null`** —
  `{ count, score, verified, unverifiedCount? }`.
- **`giveFeedback(agentId, score, opts?)` → `txHash`** — post 0–100 feedback.
  Pass `opts.payment = { txHash, payTo }` (from `PaidResult.payment`) to attach a
  proof of payment, so indexers count it as a paying review.
- **`getAddress()` → `string`** — the wallet address.
- **`balance()` → `{ usdc, eth }`** — on-chain balances (human units).
- **`approvePermit2(token)` → `txHash`** — one-time approval for Permit2 tokens.
  Not needed for USDC or USDT0, which both support EIP-3009.

### Tokens

Payers accept only the tokens listed in `NETWORKS[network].tokens`: USDC on both
networks and USDT0 on Arbitrum One. A 402 asking for any other asset is refused.

### Reputation: verified vs. unverified

With an indexer (`indexerUrl` / `CHAINPE_INDEXER_URL`), scores count only
reviewers whose feedback proves a payment to the service, and
`verified` is `true`. Without one, the SDK reads the raw on-chain summary over all
reviewers and returns `verified: false`, since fresh wallets can inflate it.

## Environment overrides

| Env var | Overrides |
|---|---|
| `CHAINPE_REGISTRY_ADDRESS` | ChainPeRegistry address |
| `ERC8004_REPUTATION_REGISTRY` / `ERC8004_IDENTITY_REGISTRY` | canonical ERC-8004 registries |
| `CHAINPE_INDEXER_URL` | indexer base URL |
| `ARBITRUM_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` | public RPC endpoints |

## Networks

| | Arbitrum One | Arbitrum Sepolia |
|---|---|---|
| Chain id / x402 network | `42161` / `eip155:42161` | `421614` / `eip155:421614` |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

The ERC-8004 registries are the canonical deployments. ChainPeRegistry and
PolicyVault addresses are listed in `docs/DEPLOYMENTS.md` once deployed; until
then set them through the options or env vars above.

Run the example:

```bash
CHAINPE_PRIVATE_KEY=0x... npx tsx examples/quickstart.ts
```

## License

MIT
