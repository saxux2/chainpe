/**
 * ChainPe x402 Proxy — Railway deployment (Arbitrum)
 *
 * A minimal, self-contained x402 v2 payment proxy built on @x402/express.
 * All configuration comes from environment variables:
 *
 *   TARGET_URL        The backend API to proxy (required)
 *   WALLET_ADDRESS    EVM address (0x) that receives payments (required)
 *   PRICE             Price per request in USDC, e.g. "0.02" (default: "0.02")
 *   NETWORK           "arbitrum-sepolia" or "arbitrum" (default: "arbitrum-sepolia")
 *   FACILITATOR_URL   x402 v2 facilitator that verifies + settles payments
 *                     (default: PayAI, which serves Arbitrum One and Sepolia)
 *   SERVICE_NAME      Display name (default: "ChainPe Service")
 *   PORT              HTTP port (Railway injects this automatically)
 *
 * Payments are USDC via x402 (EIP-3009). The payer signs the authorization; the
 * facilitator submits it on-chain and pays the gas. For CDP → PayAI failover and
 * Bazaar listing, run `chainpe start` from @chainpe/cli instead.
 */

import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'

// ── Config from environment ────────────────────────────────────────────────

const X402_NETWORKS = {
  arbitrum: 'eip155:42161',
  'arbitrum-sepolia': 'eip155:421614'
}

const TARGET_URL = process.env.TARGET_URL
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const PRICE = process.env.PRICE ?? '0.02'
const NETWORK = process.env.NETWORK ?? 'arbitrum-sepolia'
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://facilitator.payai.network'
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'ChainPe Service'
const PORT = parseInt(process.env.PORT ?? '4402', 10)

if (!TARGET_URL) {
  console.error('Missing env: TARGET_URL')
  process.exit(1)
}
if (!WALLET_ADDRESS) {
  console.error('Missing env: WALLET_ADDRESS')
  process.exit(1)
}
const X402_NETWORK = X402_NETWORKS[NETWORK]
if (!X402_NETWORK) {
  console.error(`Unsupported NETWORK "${NETWORK}". Expected: ${Object.keys(X402_NETWORKS).join(', ')}`)
  process.exit(1)
}

// ── Server ───────────────────────────────────────────────────────────────────

const app = express()
app.use(cors({ exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'] }))

// Health check (not gated)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, network: NETWORK, x402Network: X402_NETWORK })
})

// x402 payment gate — USDC on Arbitrum. "/*" gates every proxied path.
const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: FACILITATOR_URL })
).register(X402_NETWORK, new ExactEvmScheme())

app.use(
  paymentMiddleware(
    {
      '/*': {
        accepts: {
          scheme: 'exact',
          price: `$${PRICE}`,
          network: X402_NETWORK,
          payTo: WALLET_ADDRESS
        },
        description: `Pay ${PRICE} USDC per request`,
        serviceName: SERVICE_NAME
      }
    },
    resourceServer,
    { appName: SERVICE_NAME, testnet: NETWORK === 'arbitrum-sepolia' }
  )
)

// Reverse proxy to the backend
app.use('/', createProxyMiddleware({ target: TARGET_URL, changeOrigin: true }))

app.listen(PORT, () => {
  console.log(`ChainPe proxy "${SERVICE_NAME}" listening on :${PORT}`)
  console.log(`  → proxying ${TARGET_URL}`)
  console.log(`  → ${PRICE} USDC per request on ${NETWORK} (${X402_NETWORK})`)
  console.log(`  → facilitator ${FACILITATOR_URL}`)
})
