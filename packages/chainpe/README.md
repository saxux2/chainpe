# @chainpe/cli

[![npm](https://img.shields.io/npm/v/@chainpe/cli.svg)](https://www.npmjs.com/package/@chainpe/cli)

**Monetize any API with x402 micropayments on Arbitrum**

ChainPe is a reverse proxy that sits in front of your HTTP API and requires an
x402 payment on every request. One command, zero backend changes, USDC settled on
Arbitrum One or Arbitrum Sepolia. A hosted facilitator (Coinbase CDP or PayAI)
verifies and settles each payment and pays the gas, so you only need a wallet
address to get paid.

## Installation

```bash
npm install -g @chainpe/cli
```

## Quick Start

### 1. Initialize configuration

```bash
chainpe init
```

The wizard asks for:
- Your API URL (the backend to monetize)
- Service name, description and tags
- Network: `arbitrum-sepolia` (testnet) or `arbitrum` (Arbitrum One)
- Payment token (USDC; USDT0 is also offered on Arbitrum One) and price per request
- Your EVM wallet address (receives payments)
- Proxy port (default `4402`)
- Facilitator (see below)
- Whether to list the API in Coinbase's x402 Bazaar

The config is saved to `~/.chainpe/config.json`.

### 2. Start the proxy

```bash
chainpe start
```

Your API is now monetized: every request to `http://localhost:4402/*` needs a
micropayment. Unpaid requests get `402 Payment Required` with an x402 v2 offer.

### 3. Register your service (optional)

Registration lists the service in the on-chain **ChainPeRegistry** so agents can
find it, and links it to an ERC-8004 agent identity for reputation. It costs the
registry's USDC fee (see `docs/DEPLOYMENTS.md`) plus a little ETH for gas.

```bash
chainpe register
```

You can sign in two ways:
- **Browser wallet (MetaMask / Rabby)** — recommended. ChainPe opens a local page
  and you confirm the transactions in your wallet.
- **Paste private key** — signs in the terminal and also mints an ERC-8004
  identity for the service automatically.

## Facilitators

The proxy never touches the chain itself. It asks a facilitator to verify and
settle each payment, trying them in order and falling back to the next one when a
facilitator is unreachable.

| Network | Default |
|---|---|
| `arbitrum` | Coinbase CDP (when `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` are set) → PayAI |
| `arbitrum-sepolia` | PayAI (CDP doesn't support Arbitrum Sepolia) |

Overrides:
- `chainpe start --facilitator-url <url>` — use any x402 v2 facilitator, such as
  your own `services/chainpe-facilitator`.
- `chainpe start --facilitator <privateKey>` — settle in-process with a funded
  gas key (no external facilitator).
- `facilitators` / `facilitatorUrl` in `~/.chainpe/config.json`.

## x402 Bazaar listing

With discovery enabled (the default on Arbitrum One), every 402 offer declares
the x402 `bazaar` extension. Coinbase lists the resource after its first payment
settled through CDP. `chainpe init` can read input/output schemas from your API's
`/schema` endpoint. The proxy logs the listing result after each settlement.

## Commands

| Command | Description |
|---------|-------------|
| `chainpe init` | Interactive setup wizard |
| `chainpe start` | Start the x402 payment proxy |
| `chainpe register` | Register or update the service on-chain |
| `chainpe deregister` | Remove the service from the registry |
| `chainpe list` | List registered services |
| `chainpe status` | Show current config and wallet balance |
| `chainpe fetch <url>` | Call a URL as a consumer, auto-paying any 402 |
| `chainpe discover [query]` | Search the registry, x402 Bazaar and ERC-8004 agents, ranked by reputation |

`fetch` and `discover` take `--network arbitrum | arbitrum-sepolia` (default
`$CHAINPE_NETWORK` or `arbitrum`). `fetch` signs with `--key` or
`$CHAINPE_PRIVATE_KEY` and refuses to pay more than `--max` USDC (default 1).

## How it works

```
Client Request → ChainPe Proxy → 402 Payment Required (x402 v2 offer)
                     ↓
Client signs EIP-3009 authorization → Proxy → Facilitator /verify
                                                    ↓
                        Forward to your API → Facilitator /settle (pays gas)
                                                    ↓
                                      Response + PAYMENT-RESPONSE header
```

1. The client requests the proxy.
2. The proxy answers `402` with the price, `payTo` and USDC details.
3. The client signs a USDC `transferWithAuthorization` (EIP-3009).
4. The facilitator verifies the signature; the proxy forwards the request.
5. The facilitator settles on Arbitrum; the client gets the response.

## Programmatic usage

```typescript
import { startProxyServer } from "@chainpe/cli";

const { server } = await startProxyServer({
  config: {
    serviceName: "My API",
    serviceDescription: "Paid endpoint",
    tags: ["demo"],
    targetUrl: "http://localhost:3000",
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    walletAddress: "0xYOUR_ADDRESS",
    proxyPort: 4402,
    network: "arbitrum-sepolia",
  },
});
```

## Requirements

- Node.js >= 18
- An EVM address to receive USDC. ETH is only needed to register on-chain.

## License

MIT
