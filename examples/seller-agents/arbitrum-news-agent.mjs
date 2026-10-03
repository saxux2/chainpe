/**
 * Arbitrum News Seller Agent — latest Arbitrum ecosystem news, synthesized by Claude.
 *
 *   POST /news { "limit": 10 }  → top Arbitrum news + LLM synthesis (paid)
 *   GET  /health                → free
 *
 * Sources: Cointelegraph, Google News, Offchain Labs, The Block, CoinDesk, Decrypt (RSS)
 *          + DeFiLlama hacks/raises. Claude synthesis when ANTHROPIC_API_KEY is set.
 *
 * Run: node arbitrum-news-agent.mjs  (needs NEWS_PAYTO)
 */
import 'dotenv/config'
import express from 'express'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const MODEL = process.env.NEWS_MODEL || 'claude-haiku-4-5-20251001'
// The LLM synthesis is optional: without ANTHROPIC_API_KEY the agent still
// returns the raw headlines plus a rule-based digest.
const HAS_LLM = !!process.env.ANTHROPIC_API_KEY

const RSS_FEEDS = [
  { url: 'https://cointelegraph.com/rss/tag/arbitrum', source: 'Cointelegraph', filter: false },
  { url: 'https://news.google.com/rss/search?q=arbitrum+(defi+OR+ARB+OR+crypto)+when:7d&hl=en-US&gl=US&ceid=US:en', source: 'Google News', filter: false },
  { url: 'https://medium.com/feed/offchainlabs', source: 'Offchain Labs', filter: false },
  { url: 'https://www.theblock.co/rss.xml', source: 'The Block', filter: true },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', filter: true },
  { url: 'https://decrypt.co/feed', source: 'Decrypt', filter: true },
]

const isArbitrum = (text) => /arbitrum|\barb\b|offchain labs|robinhood chain|\bgmx\b/i.test(text)

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // Feeds often entity-encode their HTML, so decode before stripping tags.
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decode(m[1]) : ''
}

async function fetchFeed({ url, source, filter }) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (chainpe-news-agent)' }, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return []
    const xml = await r.text()
    return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)]
      .map(([item]) => ({
        title: tag(item, 'title'),
        description: tag(item, 'description').slice(0, 280),
        url: tag(item, 'link') || null,
        source: tag(item, 'source') || source,
        feed: source,
        publishedAt: tag(item, 'pubDate') ? new Date(tag(item, 'pubDate')).toISOString() : null,
      }))
      .filter((a) => !filter || isArbitrum(`${a.title} ${a.description}`))
  } catch {
    return []
  }
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'arbitrum-news' }))
app.get('/schema', (_req, res) => res.json({
  name: 'Arbitrum News Agent',
  routes: [
    { method: 'POST', path: '/news', paid: true,  description: 'Arbitrum ecosystem news digest. Body: { limit?: number (default 10) }. Returns: { sentiment, headline, keyDevelopments, protocols, riskFactors, tradingImplications }.' },
    { method: 'GET',  path: '/health', paid: false, description: 'Health check — free.' },
  ],
}))

app.post('/news', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.body?.limit ?? 10) || 10, 1), 30)

  try {
    const rawItems = []

    // RSS feeds (free, no keys). Arbitrum-specific feeds are taken as-is; general
    // crypto feeds are filtered for Arbitrum mentions.
    const feeds = await Promise.all(RSS_FEEDS.map((f) => fetchFeed(f)))
    // Aggregators repeat one story per outlet ("Title - Outlet"), so dedupe on
    // the bare title, and cap any one source at half the digest.
    const seen = new Set()
    const perSource = {}
    const maxPerSource = Math.ceil(limit / 2)
    feeds
      .flat()
      .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0))
      .filter((a) => {
        const key = a.title.replace(/\s+-\s+[^-]+$/, '').toLowerCase()
        if (!a.title || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .filter((a) => (perSource[a.feed] = (perSource[a.feed] ?? 0) + 1) <= maxPerSource)
      .slice(0, limit)
      .forEach((a) => rawItems.push(a))

    // DeFiLlama doesn't have a /news endpoint, use raised/hacks data as signals
    const [hacksRes, raisesRes] = await Promise.all([
      fetch('https://api.llama.fi/hacks', { headers: { Accept: 'application/json' } }).catch(() => null),
      fetch('https://api.llama.fi/raises', { headers: { Accept: 'application/json' } }).catch(() => null),
    ])

    if (hacksRes?.ok) {
      const hacks = await hacksRes.json().catch(() => [])
      ;(Array.isArray(hacks) ? hacks : [])
        .filter((h) => {
          const c = h.chain
          if (!c) return false
          return Array.isArray(c)
            ? c.some((x) => x?.toLowerCase?.().includes('arbitrum'))
            : c.toLowerCase().includes('arbitrum')
        })
        .slice(0, 3)
        .forEach((h) =>
          rawItems.push({
            title: `[HACK] ${h.name}: $${(h.amount / 1e6).toFixed(1)}M exploited`,
            description: `Technique: ${h.technique ?? 'unknown'}. Funds returned: ${h.fundsReturned ?? 0}`,
            url: h.link ?? null,
            source: 'DeFiLlama Hacks',
            publishedAt: h.date ? new Date(h.date * 1000).toISOString() : null,
          })
        )
    }

    if (raisesRes?.ok) {
      const raises = await raisesRes.json().catch(() => ({ raises: [] }))
      ;(Array.isArray(raises.raises) ? raises.raises : [])
        .filter((r) => (r.chains ?? []).includes('Arbitrum'))
        .slice(0, 3)
        .forEach((r) =>
          rawItems.push({
            title: `[RAISE] ${r.name} raised $${(r.amount / 1e6).toFixed(1)}M`,
            description: `Lead investors: ${(r.leadInvestors ?? []).join(', ') || 'undisclosed'}. Round: ${r.round ?? 'unknown'}`,
            url: r.source ?? null,
            source: 'DeFiLlama Raises',
            publishedAt: r.date ? new Date(r.date * 1000).toISOString() : null,
          })
        )
    }

    // If no real news found, synthesize from market data
    const newsContext =
      rawItems.length > 0
        ? rawItems
            .slice(0, limit)
            .map((n) => `• ${n.title}: ${n.description}`)
            .join('\n')
        : 'No specific news articles available. Use your knowledge of recent Arbitrum ecosystem developments.'

    let synthesis
    try {
      if (!HAS_LLM) throw new Error('ANTHROPIC_API_KEY not set')
      const { object } = await generateObject({
        model: anthropic(MODEL),
        schema: z.object({
          headline: z.string().describe('One punchy headline for the Arbitrum ecosystem today'),
          sentiment: z.enum(['bullish', 'bearish', 'neutral']),
          keyDevelopments: z.array(z.string()).describe('3-5 most important things happening on Arbitrum right now'),
          protocols: z.array(z.string()).describe('2-4 specific protocols worth watching'),
          riskFactors: z.array(z.string()).describe('2-3 risks to consider'),
          tradingImplications: z.string().describe('1-2 sentences on what this means for trading ETH and ARB'),
        }),
        prompt:
          `You are an Arbitrum ecosystem analyst. Based on this news and your knowledge of the current state ` +
          `of Arbitrum, produce a concise investment-relevant news digest.\n\nNews:\n${newsContext}`,
      })
      synthesis = object
    } catch (llmErr) {
      // Degrade gracefully: return raw signals without LLM synthesis
      const hackCount = rawItems.filter((i) => i.source?.includes('Hack')).length
      synthesis = {
        headline: rawItems[0]?.title ?? 'Arbitrum ecosystem update',
        sentiment: hackCount > 0 ? 'bearish' : 'neutral',
        keyDevelopments: rawItems.slice(0, 5).map((i) => i.title).filter(Boolean),
        protocols: ['GMX', 'Aave', 'Uniswap', 'Pendle'].filter((p) =>
          rawItems.some((i) => `${i.title} ${i.description}`.toLowerCase().includes(p.toLowerCase()))
        ),
        riskFactors: rawItems.filter((i) => i.source?.includes('Hack')).map((i) => i.title),
        tradingImplications: 'No LLM synthesis — raw headlines only. Read the articles before trading.',
        llmSkipped: true,
        llmError: llmErr?.message?.slice(0, 100),
      }
    }

    res.json({
      agent: 'arbitrum-news-agent',
      model: HAS_LLM ? MODEL : null,
      timestamp: new Date().toISOString(),
      articlesFound: rawItems.length,
      articles: rawItems.slice(0, limit),
      ...synthesis,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.NEWS_NAME || 'Arbitrum News Agent',
  app,
  backendPort: Number(process.env.NEWS_BACKEND_PORT || 5104),
  proxyPort: Number(process.env.NEWS_PROXY_PORT || 4504),
  payTo: requireEnv('NEWS_PAYTO'),
  price: process.env.NEWS_PRICE || '0.02',
  description: 'Latest Arbitrum ecosystem and DeFi news (Cointelegraph, The Block, CoinDesk, Decrypt, Google News) plus DeFiLlama hacks and raises, with an optional Claude digest.',
  tags: ['arbitrum', 'news', 'defi', 'research'],
  agentId: process.env.NEWS_AGENT_ID,
})
