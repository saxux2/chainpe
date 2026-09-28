/**
 * News-digest seller agent — paid per call in USDC on Arbitrum.
 *
 *   POST /summarize { "text": "..." }  → LLM summary + bullets (paid)
 *   GET  /health                       → free
 *
 * Run: node news-digest-agent.mjs   (needs ANTHROPIC_API_KEY + DIGEST_PAYTO)
 */
import 'dotenv/config'
import express from 'express'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const MODEL = process.env.DIGEST_MODEL || 'claude-haiku-4-5-20251001'
if (!process.env.ANTHROPIC_API_KEY) requireEnv('ANTHROPIC_API_KEY')

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'news-digest' }))

app.post('/summarize', async (req, res) => {
  const text = req.body?.text
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Request body must include a string "text".' })
  }
  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: z.object({
        summary: z.string().describe('A tight 2-3 sentence digest'),
        bulletPoints: z.array(z.string()).describe('3-6 key takeaways'),
        sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
      }),
      prompt: `Summarize the following into a digest with key takeaways.\n\n${text}`,
    })
    res.json({ agent: 'news-digest-agent', model: MODEL, ...object })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.DIGEST_NAME || 'News Digest Agent',
  app,
  backendPort: Number(process.env.DIGEST_BACKEND_PORT || 5102),
  proxyPort: Number(process.env.DIGEST_PROXY_PORT || 4502),
  payTo: requireEnv('DIGEST_PAYTO'),
  price: process.env.DIGEST_PRICE || '0.01',
  description: 'LLM news-digest agent — POST /summarize {text} returns a summary + bullets.',
  tags: ['ai', 'news', 'summarize', 'agent'],
  agentId: process.env.DIGEST_AGENT_ID,
})
