/**
 * Arbitrum DEX Seller Agent — best-route swap quotes on Arbitrum One, paid per call.
 *
 *   POST /quote    { fromToken, toToken, amountIn, slippagePct? }  → best route via KyberSwap's aggregator
 *   GET  /tokens   → supported tokens on Arbitrum One
 *   GET  /health   → free
 *
 * QUOTE-ONLY: the agent never signs or executes a swap and holds no keys besides
 * its payTo address. Quotes come from Arbitrum One liquidity (Arbitrum Sepolia
 * has almost none), even when the agent itself is paid on Sepolia.
 *
 * Run: node arbitrum-dex-agent.mjs  (needs DEX_PAYTO)
 */
import 'dotenv/config'
import express from 'express'
import { parseUnits, formatUnits } from 'viem'
import { startSeller, requireEnv } from './seller-runtime.mjs'

// ── Arbitrum One tokens ──────────────────────────────────────────────────────

const TOKENS = {
  USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, symbol: 'USDC' },
  USDT0: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, symbol: 'USDT0' },
  WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, symbol: 'WETH' },
  ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18, symbol: 'ARB' },
  WBTC: { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8, symbol: 'WBTC' },
}
// Native ETH is quoted as WETH.
const ALIASES = { ETH: 'WETH' }

const KYBER_URL = 'https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes'

function resolveToken(symbol) {
  const upper = String(symbol ?? '').toUpperCase()
  const token = TOKENS[ALIASES[upper] ?? upper]
  if (!token) throw new Error(`Unknown token: ${symbol}. Supported: ETH, ${Object.keys(TOKENS).join(', ')}`)
  return token
}

async function getQuote(from, to, amountInAtomic) {
  const url = `${KYBER_URL}?tokenIn=${from.address}&tokenOut=${to.address}&amountIn=${amountInAtomic}`
  const r = await fetch(url, { headers: { Accept: 'application/json', 'x-client-id': 'chainpe-example' } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body.code !== 0 || !body.data?.routeSummary) {
    throw new Error(`KyberSwap quote failed: ${body.message ?? r.status}`)
  }
  const rs = body.data.routeSummary
  return {
    amountOutAtomic: BigInt(rs.amountOut),
    amountInUsd: Number(rs.amountInUsd),
    amountOutUsd: Number(rs.amountOutUsd),
    gasUsd: Number(rs.gasUsd),
    router: body.data.routerAddress,
    hops: rs.route.flat().map((h) => h.exchange),
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'arbitrum-dex' }))
app.get('/schema', (_req, res) => res.json({
  name: 'Arbitrum DEX Agent',
  routes: [
    { method: 'POST', path: '/quote', paid: true, description: 'Best-route swap quote on Arbitrum One (KyberSwap aggregator). Body: { fromToken: "USDC"|"USDT0"|"ETH"|"WETH"|"ARB"|"WBTC", toToken, amountIn: string, slippagePct?: number }. Quote only — nothing is executed.' },
    { method: 'GET',  path: '/tokens', paid: true, description: 'List supported tokens and contract addresses.' },
    { method: 'GET',  path: '/health', paid: false, description: 'Health check — free.' },
  ],
}))

app.get('/tokens', (_req, res) => {
  res.json({
    agent: 'arbitrum-dex-agent',
    network: 'arbitrum',
    aggregator: 'KyberSwap',
    tokens: TOKENS,
    aliases: ALIASES,
  })
})

app.post('/quote', async (req, res) => {
  const { fromToken: fromSym, toToken: toSym, amountIn, slippagePct = 0.5 } = req.body ?? {}
  if (!fromSym || !toSym || !amountIn) {
    return res.status(400).json({ error: 'Required: fromToken, toToken, amountIn' })
  }
  try {
    const from = resolveToken(fromSym)
    const to = resolveToken(toSym)
    const amountInAtomic = parseUnits(String(amountIn), from.decimals)
    const q = await getQuote(from, to, amountInAtomic)

    const amountOut = formatUnits(q.amountOutAtomic, to.decimals)
    const minOutAtomic = (q.amountOutAtomic * BigInt(Math.floor((1 - slippagePct / 100) * 10000))) / 10000n

    res.json({
      agent: 'arbitrum-dex-agent',
      mode: 'quote',
      network: 'arbitrum',
      aggregator: 'KyberSwap',
      router: q.router,
      route: q.hops,
      from: { token: from.symbol, amount: String(amountIn), usd: q.amountInUsd },
      to: { token: to.symbol, amount: amountOut, usd: q.amountOutUsd },
      rate: Number(amountOut) / Number(amountIn),
      slippagePct,
      minReceived: formatUnits(minOutAtomic, to.decimals),
      estimatedGasUsd: q.gasUsd,
      timestamp: new Date().toISOString(),
      note: 'Quote only. Execute through your own wallet or the KyberSwap router if you want to trade.',
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.DEX_NAME || 'Arbitrum DEX Agent',
  app,
  backendPort: Number(process.env.DEX_BACKEND_PORT || 5106),
  proxyPort: Number(process.env.DEX_PROXY_PORT || 4506),
  payTo: requireEnv('DEX_PAYTO'),
  price: process.env.DEX_PRICE || '0.01',
  description: 'Best-route swap quotes on Arbitrum One (USDC, USDT0, ETH, ARB, WBTC) via the KyberSwap aggregator.',
  tags: ['arbitrum', 'dex', 'swap', 'quote', 'trading'],
  agentId: process.env.DEX_AGENT_ID,
})
