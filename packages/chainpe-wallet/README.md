# ChainPe Wallet (MCP)

> Give Claude an Arbitrum wallet that discovers and pays for x402 services —
> from the **ChainPe** registry, Coinbase's **x402 Bazaar** and **ERC-8004**
> agent registrations.

ChainPe Wallet is a [Model Context Protocol](https://modelcontextprotocol.io)
server packaged as a Claude Desktop extension (`.mcpb`). Install it, add your
wallet key, set spending limits, and Claude can find paid services, pay for them
in USDC within your budget, and return the results in the chat.

No hosted backend or account is needed: discovery reads the chain and the public
Bazaar directly.

## How it works

1. **`search_bazaar`** searches the ChainPeRegistry (when an address is
   configured), Coinbase's x402 Bazaar and ERC-8004 registration files, and lists
   each service with its price, endpoint and reputation.
2. **`x402_fetch`** calls a service endpoint; on `402 Payment Required` it signs
   a USDC payment (x402 v2, EIP-3009) and retries automatically.
3. A **spending tracker** enforces `MAX_PER_CALL` and `MAX_PER_DAY` (USDC)
   *before* any payment is signed.

All tools:

| Tool | What it does |
|---|---|
| `search_bazaar` | Discover x402 services, ranked by reputation |
| `x402_fetch` | Fetch a URL, paying any 402 automatically |
| `check_balance` | USDC and ETH balance and wallet address |
| `pay` | Sign an x402 USDC payment authorization |
| `transfer_usdc` | Send USDC to any address |
| `transfer_eth` | Send ETH (for gas) |
| `spending_report` | What the agent spent today, and the limits |
| `request_funding` | EIP-681 top-up link for USDC or ETH |
| `give_feedback` | Post an ERC-8004 reputation score (0–100) |

**On-chain reputation (ERC-8004):** after a successful paid `x402_fetch`, the
wallet posts a positive score for the provider's agent, with the settlement
transaction attached as proof of payment. `give_feedback` lets you score a
provider manually; pass `paymentTxHash` and `payTo` to attach the same proof.
`search_bazaar` marks each score as verified (from a ChainPe indexer, paying
reviewers only) or unverified (raw on-chain summary).

## Configuration

Set via the Claude Desktop config form (or env vars when run directly):

| Field | Env var | Default |
|---|---|---|
| Wallet private key (0x…) | `CHAINPE_PRIVATE_KEY` | — (read-only if unset) |
| Network (`arbitrum-sepolia` / `arbitrum`) | `NETWORK` | `arbitrum-sepolia` |
| Max USDC per payment | `MAX_PER_CALL` | `0.10` |
| Max USDC per day | `MAX_PER_DAY` | `20.00` |
| ChainPeRegistry address | `CHAINPE_REGISTRY_ADDRESS` | — (registry search skipped if unset) |
| ERC-8004 Reputation Registry | `ERC8004_REPUTATION_REGISTRY` | canonical registry for the network |
| ChainPe indexer URL (env only, not in the form) | `CHAINPE_INDEXER_URL` | — (scores read on-chain, unverified) |

The wallet defaults to **Arbitrum Sepolia**. Get test USDC from
https://faucet.circle.com and a little Sepolia ETH for `transfer_*` tools
(x402 payments themselves need no ETH — the provider's facilitator pays gas).
Switch `NETWORK` to `arbitrum` for real USDC on Arbitrum One.

### Claude Desktop without the `.mcpb`

The server is published to npm as `chainpe-wallet-mcp`, so any MCP client can
run it with `npx`:

```json
{
  "mcpServers": {
    "chainpe-wallet": {
      "command": "npx",
      "args": ["-y", "chainpe-wallet-mcp"],
      "env": {
        "CHAINPE_PRIVATE_KEY": "0x…",
        "NETWORK": "arbitrum-sepolia",
        "MAX_PER_CALL": "0.10",
        "MAX_PER_DAY": "20.00"
      }
    }
  }
}
```

## Build

```bash
npm install          # from the monorepo root
npm run build        # tsup → dist/index.js
npm run build:mcpb   # produces chainpe.mcpb (double-click to install in Claude Desktop)
npm test             # vitest
```

## Develop against a local MCP client

Run `dist/index.js` over stdio. For a quick check you can connect with the MCP
SDK client (`@modelcontextprotocol/sdk/client`) or the MCP Inspector and call
`search_bazaar` with a query such as `"weather"`.
