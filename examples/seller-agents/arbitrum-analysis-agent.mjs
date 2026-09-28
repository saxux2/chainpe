/**
 * Arbitrum Analysis Seller Agent — Claude-powered ETH/USDC analysis for Arbitrum.
 *
 *   POST /analyze { price, news, portfolio? }  → BUY/SELL/HOLD on ETH with position sizing (paid)
 *   GET  /health                               → free
 *
 * Run: node arbitrum-analysis-agent.mjs  (needs ANTHROPIC_API_KEY + ANALYSIS_PAYTO)
 */
import 'dotenv/config'
import express from 'express'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const MODEL = process.env.ANALYSIS_MODEL || 'claude-sonnet-5'
if (!process.env.ANTHROPIC_API_KEY) requireEnv('ANTHROPIC_API_KEY')

const app = express()
app.use(express.json({ limit: '512kb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'arbitrum-analysis' }))
app.get('/schema', (_req, res) => res.json({
  name: 'Arbitrum Analysis Agent',
  routes: [
    { method: 'POST', path: '/analyze', paid: true, description: 'ETH/USDC analysis on Arbitrum. Body: { price?: <from price agent>, news?: <from news agent>, portfolio?: { usdcBalance, ethAmount } }. Returns: { action: BUY|SELL|HOLD, confidence, targetEntryUsd, targetExitUsd, stopLossUsd, positionSizePercent, rationale }.' },
    { method: 'GET',  path: '/health',  paid: false, description: 'Health check — free.' },
  ],
}))

const pct = (v) => (typeof v === 'number' ? v.toFixed(2) : '?')
const big = (v, div, unit) => (typeof v === 'number' ? (v / div).toFixed(2) + unit : '?')

app.post('/analyze', async (req, res) => {
  const { price, news, portfolio } = req.body ?? {}

  if (!price && !news) {
    return res.status(400).json({
      error: 'Provide at least one of: price (from arbitrum-price-agent) or news (from arbitrum-news-agent).',
    })
  }

  const priceCtx = price
    ? [
        `ETH/USD: $${price.eth?.usd ?? 'unknown'} (24h ${pct(price.eth?.change24h)}%)`,
        `ETH 24h volume: $${big(price.eth?.volume24h, 1e9, 'B')}`,
        `ARB/USD: $${price.arb?.usd ?? 'unknown'} (24h ${pct(price.arb?.change24h)}%)`,
        `Arbitrum TVL: $${big(price.arbitrumTvl, 1e9, 'B')}`,
      ].join('\n')
    : 'No price data provided.'

  const newsCtx = news
    ? [
        `Sentiment: ${news.sentiment}`,
        `Headline: ${news.headline}`,
        `Key developments: ${(news.keyDevelopments ?? []).join('; ')}`,
        `Protocols to watch: ${(news.protocols ?? []).join(', ')}`,
        `Risk factors: ${(news.riskFactors ?? []).join('; ')}`,
        `Trading implications: ${news.tradingImplications}`,
      ].join('\n')
    : 'No news data provided.'

  const portfolioCtx = portfolio
    ? `Current portfolio: ETH position = ${portfolio.ethAmount ?? 0} ETH, USDC balance = $${portfolio.usdcBalance ?? 0}`
    : 'No current portfolio data.'

  try {
    let analysis
    try {
      const { object } = await generateObject({
        model: anthropic(MODEL),
        schema: z.object({
          action: z.enum(['BUY', 'SELL', 'HOLD']).describe('Recommended action on ETH'),
          confidence: z.number().min(0).max(100).describe('Confidence score 0–100'),
          targetEntryUsd: z.number().nullable().describe('Recommended ETH entry price in USD, null for HOLD/SELL'),
          targetExitUsd: z.number().nullable().describe('Take-profit price in USD'),
          stopLossUsd: z.number().nullable().describe('Stop-loss price in USD'),
          positionSizePercent: z.number().min(0).max(100).describe('Suggested position size as % of portfolio'),
          timeHorizon: z.enum(['short-term (<24h)', 'medium-term (1-7d)', 'long-term (>7d)']).describe('Suggested holding period'),
          rationale: z.string().describe('2-3 sentence reasoning for this recommendation'),
          technicalSignals: z.array(z.string()).describe('2-4 technical signals supporting this call'),
          keyRisks: z.array(z.string()).describe('2-3 specific risks that could invalidate this thesis'),
          onChainInsights: z.array(z.string()).describe('1-3 Arbitrum on-chain / DeFi observations'),
        }),
        prompt:
          `You are a quantitative DeFi analyst covering the Arbitrum ecosystem. ` +
          `Analyze the following data and give a precise, actionable recommendation for trading ETH against USDC on Arbitrum.\n\n` +
          `## Market Data\n${priceCtx}\n\n` +
          `## Ecosystem News & Sentiment\n${newsCtx}\n\n` +
          `## Current Portfolio\n${portfolioCtx}\n\n` +
          `Be specific with price targets. Treat Arbitrum TVL and ARB momentum as ecosystem signals. ` +
          `Weight news sentiment vs. price momentum. Keep position sizing conservative (max 30%). This is a demo, not financial advice.`,
      })
      analysis = object
    } catch (llmErr) {
      // Rule-based fallback when the LLM is unavailable
      const ethChange = price?.eth?.change24h ?? 0
      const arbChange = price?.arb?.change24h ?? 0
      const newsSentiment = news?.sentiment ?? 'neutral'

      const bullSignals = (ethChange > 1 ? 1 : 0) + (arbChange > 0 ? 1 : 0) + (newsSentiment === 'bullish' ? 1 : 0)
      const bearSignals = (ethChange < -1 ? 1 : 0) + (arbChange < -3 ? 1 : 0) + (newsSentiment === 'bearish' ? 2 : 0)

      const action = bullSignals >= 2 ? 'BUY' : bearSignals >= 3 ? 'SELL' : 'HOLD'
      const currentPrice = price?.eth?.usd ?? 0

      analysis = {
        action,
        confidence: 45,
        targetEntryUsd: action === 'BUY' ? currentPrice : null,
        targetExitUsd: action === 'BUY' ? currentPrice * 1.05 : null,
        stopLossUsd: action === 'BUY' ? currentPrice * 0.96 : null,
        positionSizePercent: action !== 'HOLD' ? 15 : 0,
        timeHorizon: 'short-term (<24h)',
        rationale: `Rule-based fallback (LLM unavailable). ETH 24h: ${ethChange.toFixed(2)}%, ARB 24h: ${arbChange.toFixed(2)}%, sentiment: ${newsSentiment}. Bull signals: ${bullSignals}, bear signals: ${bearSignals}.`,
        technicalSignals: [
          `ETH 24h change: ${ethChange > 0 ? '+' : ''}${ethChange.toFixed(2)}%`,
          `ARB 24h change: ${arbChange > 0 ? '+' : ''}${arbChange.toFixed(2)}%`,
          `News sentiment: ${newsSentiment}`,
        ],
        keyRisks: ['LLM analysis unavailable — low confidence'],
        onChainInsights: [`Arbitrum TVL: $${big(price?.arbitrumTvl, 1e9, 'B')}`],
        llmSkipped: true,
        llmError: llmErr?.message?.slice(0, 100),
      }
    }

    res.json({
      agent: 'arbitrum-analysis-agent',
      model: MODEL,
      timestamp: new Date().toISOString(),
      asset: 'ETH',
      currentPrice: price?.eth?.usd ?? null,
      ...analysis,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.ANALYSIS_NAME || 'Arbitrum Analysis Agent',
  app,
  backendPort: Number(process.env.ANALYSIS_BACKEND_PORT || 5105),
  proxyPort: Number(process.env.ANALYSIS_PROXY_PORT || 4505),
  payTo: requireEnv('ANALYSIS_PAYTO'),
  price: process.env.ANALYSIS_PRICE || '0.05',
  description: 'Claude-powered ETH/USDC analysis on Arbitrum: BUY/SELL/HOLD with price targets and position sizing.',
  tags: ['arbitrum', 'eth', 'analysis', 'trading', 'ai'],
  agentId: process.env.ANALYSIS_AGENT_ID,
})
