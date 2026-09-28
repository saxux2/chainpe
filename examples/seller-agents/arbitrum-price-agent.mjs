/**
 * Arbitrum Price Seller Agent — live ETH/ARB prices + Arbitrum DeFi data, paid per call.
 *
 *   GET  /price     → live ETH and ARB prices, 24h change, volume, Arbitrum TVL (CoinGecko + DeFiLlama)
 *   GET  /defi      → top Arbitrum protocols by TVL + highest-yield pools (DeFiLlama)
 *   GET  /health    → free
 *
 * No external API keys required — uses public endpoints.
 * Run: node arbitrum-price-agent.mjs
 */
import 'dotenv/config'
import express from 'express'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'arbitrum-price' }))
app.get('/schema', (_req, res) => res.json({
  name: 'Arbitrum Price Agent',
  routes: [
    { method: 'GET', path: '/price', paid: true,  description: 'Live ETH and ARB prices, 24h change, volume, market cap, Arbitrum TVL.' },
    { method: 'GET', path: '/defi',  paid: true,  description: 'Top Arbitrum DeFi protocols by TVL + highest yield pools.' },
    { method: 'GET', path: '/health',paid: false, description: 'Health check — free.' },
  ],
}))

const coin = (c) => c ? {
  usd: c.usd ?? null,
  change24h: c.usd_24h_change ?? null,
  volume24h: c.usd_24h_vol ?? null,
  marketCap: c.usd_market_cap ?? null,
} : null

app.get('/price', async (_req, res) => {
  try {
    const [cgRes, dlRes] = await Promise.all([
      fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,arbitrum&vs_currencies=usd' +
        '&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true',
        { headers: { Accept: 'application/json' } }
      ),
      fetch('https://api.llama.fi/v2/chains', { headers: { Accept: 'application/json' } }),
    ])

    const cg = await cgRes.json()
    const chains = await dlRes.json()
    const arbChain = Array.isArray(chains) ? chains.find((c) => c.name === 'Arbitrum') : null

    res.json({
      agent: 'arbitrum-price-agent',
      timestamp: new Date().toISOString(),
      eth: coin(cg.ethereum),
      arb: coin(cg.arbitrum),
      arbitrumTvl: arbChain?.tvl ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

app.get('/defi', async (_req, res) => {
  try {
    const [protRes, yieldRes] = await Promise.all([
      fetch('https://api.llama.fi/protocols', { headers: { Accept: 'application/json' } }),
      fetch('https://yields.llama.fi/pools', { headers: { Accept: 'application/json' } }),
    ])

    const protocols = await protRes.json()
    const yields = await yieldRes.json()

    // Top 10 protocols by their Arbitrum TVL
    const arbProtocols = (Array.isArray(protocols) ? protocols : [])
      .map((p) => ({ ...p, arbTvl: p.chainTvls?.Arbitrum ?? 0 }))
      .filter((p) => p.arbTvl > 0)
      .sort((a, b) => b.arbTvl - a.arbTvl)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        category: p.category,
        arbitrumTvlUsd: p.arbTvl,
        change1d: p.change_1d,
        change7d: p.change_7d,
      }))

    // Top 10 Arbitrum yield pools by APY
    const arbPools = (yields.data ?? [])
      .filter((p) => p.chain === 'Arbitrum' && p.apy > 0 && p.tvlUsd > 100_000)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 10)
      .map((p) => ({
        pool: p.pool,
        project: p.project,
        symbol: p.symbol,
        tvlUsd: p.tvlUsd,
        apy: p.apy,
        apyBase: p.apyBase,
        apyReward: p.apyReward,
      }))

    res.json({
      agent: 'arbitrum-price-agent',
      timestamp: new Date().toISOString(),
      topProtocols: arbProtocols,
      topYieldPools: arbPools,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.PRICE_NAME || 'Arbitrum Price Agent',
  app,
  backendPort: Number(process.env.PRICE_BACKEND_PORT || 5103),
  proxyPort: Number(process.env.PRICE_PROXY_PORT || 4503),
  payTo: requireEnv('PRICE_PAYTO'),
  price: process.env.PRICE_PRICE || '0.005',
  description: 'Live ETH and ARB prices, Arbitrum TVL, and top Arbitrum DeFi protocols and yields.',
  tags: ['arbitrum', 'eth', 'arb', 'price', 'defi', 'data'],
  agentId: process.env.PRICE_AGENT_ID,
})
