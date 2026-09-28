# ChainPe Provider Developer Setup

**Monetize your APIs with x402 payments — earn USDC on Arbitrum for every API call.**

---

## 🚀 5-Minute Setup

### Step 1: Install the CLI

```bash
npm install -g @chainpe/cli
```

Or use it programmatically in your project:

```bash
npm install @chainpe/cli
```

### Step 2: Get an EVM wallet address

You need an address to **receive** payments, not its private key:

1. Open any EVM wallet (MetaMask, Rabby, a Safe, an exchange deposit address that
   supports Arbitrum USDC, …).
2. Copy your `0x…` address.

**Why no private key?** Payments are signed by the payer and settled by a
facilitator straight into your wallet. The proxy only asks the facilitator to
verify and settle; it never signs anything. You need a key (and a little ETH) only
if you register the service on-chain.

### Step 3: Initialize provider configuration

```bash
chainpe init
```

The wizard asks:

```
? Your API URL (the backend ChainPe will proxy) › http://localhost:3001
? Service name (for registry listing) › Weather API
? Service description › Real-time weather data
? Tags (comma-separated, for discovery) › weather, forecast
? Arbitrum network › Arbitrum Sepolia (testnet)
? Price per request (USDC) › 0.01
? Your EVM wallet address (0x…, receives payments on Arbitrum) › 0x…
? Proxy port › 4402
? x402 facilitator (verifies + settles payments) › Recommended
? List this API in Coinbase's x402 Bazaar? › Yes
```

This creates `~/.chainpe/config.json`.

### Step 4: Start your backend API

Your backend runs on its own and knows nothing about payments:

```javascript
// backend-api.js
import express from 'express';
const app = express();

app.get('/weather', (req, res) => {
  res.json({ city: req.query.city, temp: 22, condition: 'Sunny' });
});

app.listen(3001, () => console.log('Backend API running on port 3001'));
```

```bash
node backend-api.js
```

### Step 5: Start the x402 payment gateway

```bash
chainpe start
```

The proxy prints the service, price, wallet, network and the facilitators it uses
(for example `Using facilitators: PayAI`), then listens on
`http://localhost:4402`. Your API is now behind x402 payments. 🎉

Try it without paying:

```bash
curl -i http://localhost:4402/weather?city=london   # → 402 Payment Required
```

And as a paying client (needs test USDC from https://faucet.circle.com):

```bash
CHAINPE_PRIVATE_KEY=0x… chainpe fetch -n arbitrum-sepolia "http://localhost:4402/weather?city=london"
```

### Step 6: Register your service (optional)

Register in the on-chain **ChainPeRegistry** so agents can discover your service:

```bash
chainpe register
```

This sends the registration transaction on Arbitrum (registry fee in USDC plus
gas in ETH). Sign with a browser wallet, or paste a private key, which also mints
an ERC-8004 agent identity for the service. The ChainPeRegistry address comes
from your config or `CHAINPE_REGISTRY_ADDRESS`.

---

## 📊 How It Works

```
Agent Request → x402 Proxy (port 4402) → Payment header present?
                    ↓ no                          ↓ yes
          402 Payment Required        Facilitator /verify → forward to backend
          (x402 v2 offer: price,                 ↓
           payTo, USDC, network)       Facilitator /settle (pays gas)
                                                 ↓
                                  Response + PAYMENT-RESPONSE header
```

**Payment flow:**
1. The agent calls your endpoint through the proxy.
2. The proxy answers `402` with an x402 v2 offer (`eip155:421614` or `eip155:42161`).
3. The agent signs a USDC `transferWithAuthorization` (EIP-3009) and retries with
   a `PAYMENT-SIGNATURE` header.
4. The facilitator verifies the signature.
5. The proxy forwards the request to your backend.
6. The facilitator submits the transfer on Arbitrum and pays the gas.
7. USDC lands in **your** wallet; the agent gets the response.

---

## 🔧 Configuration Reference

### Config file location

`~/.chainpe/config.json`

### Config structure

```json
{
  "serviceName": "Weather API",
  "serviceDescription": "Real-time weather data with forecasts",
  "tags": ["weather", "forecast", "data"],
  "targetUrl": "http://localhost:3001",
  "pricePerRequest": "0.01",
  "paymentToken": "USDC",
  "walletAddress": "0xYOUR_WALLET_ADDRESS",
  "proxyPort": 4402,
  "network": "arbitrum-sepolia",
  "logLevel": "normal"
}
```

### Configuration options

| Field | Description | Example |
|-------|-------------|---------|
| `serviceName` | Your service name | `"Weather API"` |
| `serviceDescription` | Short description | `"Real-time weather data"` |
| `tags` | Searchable tags | `["weather", "data"]` |
| `targetUrl` | Your backend API URL | `"http://localhost:3001"` |
| `pricePerRequest` | Price per request, in the payment token | `"0.01"` |
| `paymentToken` | `"USDC"`, or `"USDT0"` on Arbitrum One | `"USDC"` |
| `walletAddress` | Your receiving address | `"0x…"` |
| `proxyPort` | x402 proxy port | `4402` |
| `network` | `"arbitrum-sepolia"` or `"arbitrum"` | `"arbitrum-sepolia"` |
| `registryAddress` | ChainPeRegistry deployment | `"0x…"` |
| `agentId` | ERC-8004 agent id, advertised on 402 offers | `"42"` |
| `facilitators` | Ordered list: `{ "kind": "cdp" }`, `{ "kind": "payai" }`, `{ "kind": "url", "url": "…" }` | see below |
| `facilitatorUrl` | Shorthand for one `url` facilitator | `"https://…"` |
| `discovery` | x402 Bazaar metadata (`enabled`, `inputSchema`, `outputSchema`, `inputExample`, `outputExample`, `method`) | `{ "enabled": true }` |
| `adminKey` | Protects `/chainpe-admin/*` | `"long-random-string"` |
| `logLevel` | `"quiet"`, `"normal"` or `"verbose"` | `"normal"` |

### Facilitators

Defaults: on `arbitrum`, Coinbase CDP (when `CDP_API_KEY_ID` and
`CDP_API_KEY_SECRET` are set) then PayAI; on `arbitrum-sepolia`, PayAI. The proxy
tries them in order and moves to the next when one is unreachable.

```json
{
  "facilitators": [
    { "kind": "cdp" },
    { "kind": "url", "url": "https://your-facilitator.example.com" },
    { "kind": "payai" }
  ]
}
```

To run your own facilitator, see `services/chainpe-facilitator`.

---

## 🛠️ CLI Commands

| Command | Description |
|---------|-------------|
| `chainpe init` | Initialize provider config |
| `chainpe start` | Start the x402 payment gateway |
| `chainpe start --port 5000` | Start on a custom port |
| `chainpe start --facilitator-url <url>` | Use one facilitator instead of the configured list |
| `chainpe start --facilitator <privateKey>` | Settle in-process with a funded gas key |
| `chainpe register` | Register or update the service on-chain |
| `chainpe deregister` | Remove the service from the registry |
| `chainpe list` | List registered services |
| `chainpe status` | Show config and wallet balance |

### Proxy endpoints (not payment-gated)

| Path | Returns |
|---|---|
| `GET /health` | liveness |
| `GET /chainpe-admin/stats` | request and revenue counters |
| `GET /chainpe-admin/payments` | recent payments |
| `GET /chainpe-admin/config` | public config |
| `GET /chainpe-admin/schema` | your backend's `/schema`, if it has one |

Set `adminKey` to require an `x-admin-key` header on `/chainpe-admin/*`.

---

## 🎯 Examples

### Python Flask API

```python
# app.py
from flask import Flask, jsonify, request

app = Flask(__name__)

@app.route('/analyze')
def analyze():
    text = request.args.get('text', '')
    return jsonify({'sentiment': 'positive', 'score': 0.85, 'text_length': len(text)})

if __name__ == '__main__':
    app.run(port=3001)
```

```bash
# Terminal 1: start Flask
python app.py

# Terminal 2: run `chainpe init` with http://localhost:3001 as the API URL, then
chainpe start
```

Any language works: the proxy speaks plain HTTP to your backend.

### Per-path prices (programmatic)

The config file sets one price for every path. For different prices per path,
start the proxy from code with `additionalRoutes`:

```typescript
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startProxyServer } from "@chainpe/cli";

const config = JSON.parse(readFileSync(join(homedir(), ".chainpe", "config.json"), "utf8"));

await startProxyServer({
  config,
  additionalRoutes: [
    { path: "/premium/*", pricePerRequest: "0.10", paymentToken: "USDC" },
    { path: "/basic/*", pricePerRequest: "0.01", paymentToken: "USDC" },
  ],
});
```

---

## 📈 Monitoring Revenue

- The proxy logs every settled payment with its transaction hash.
- `GET /chainpe-admin/stats` shows totals since start.
- Every payment is a USDC transfer to your wallet, visible on
  [arbiscan.io](https://arbiscan.io) (mainnet) or
  [sepolia.arbiscan.io](https://sepolia.arbiscan.io) (testnet).

---

## 🔐 Security

- The proxy never needs your private key and never signs.
- Payments go straight to your wallet; nothing is held in between.
- Facilitators only relay the payer's signed authorization and pay gas.

Best practices:
1. **Use a dedicated wallet** for receiving payments.
2. **Set `adminKey`** before exposing the proxy publicly.
3. **Rate limit and validate inputs** in your backend.
4. **Use HTTPS** in production.

---

## 🚀 Going to Production

### Checklist

- [ ] Test end to end on Arbitrum Sepolia with faucet USDC
- [ ] Switch `network` to `arbitrum`
- [ ] Set `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` for Coinbase's facilitator (optional; PayAI works without keys)
- [ ] Use a mainnet receiving address
- [ ] Set `adminKey` and HTTPS
- [ ] Register the service on Arbitrum One

### Deployment options

**Docker:**
```dockerfile
FROM node:20-slim
RUN npm install -g @chainpe/cli
COPY config.json /root/.chainpe/config.json
CMD ["chainpe", "start"]
```

**systemd:**
```ini
[Unit]
Description=ChainPe x402 Gateway

[Service]
ExecStart=/usr/local/bin/chainpe start
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 🐛 Troubleshooting

### "Cannot connect to backend"
- Check the backend is running and `targetUrl` is right.
- Test it directly: `curl http://localhost:3001/your-endpoint`.

### "Port already in use"
- Change `proxyPort`, or run `chainpe start --port 5000`.

### Payments fail to verify or settle
- Check `network` matches what the client pays on (`arbitrum-sepolia` vs `arbitrum`).
- Check the payer holds enough USDC (the payer needs no ETH).
- Run `chainpe start -v` to see facilitator responses. If a facilitator is down,
  add another to `facilitators`.

### "Service not discoverable"
- Run `chainpe register` to list it in the ChainPeRegistry.
- Check it shows up with `chainpe discover <name> -n <network>`.
- For the x402 Bazaar: keep `discovery.enabled` on; Coinbase lists the resource
  after its first payment settled through CDP (Arbitrum One only).

---

## 🤝 Need Help?

- **Documentation**: https://github.com/saxux2/chainpe
- **Issues**: https://github.com/saxux2/chainpe/issues
