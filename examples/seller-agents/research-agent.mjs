/**
 * Research seller agent — paid per call in USDC on Arbitrum.
 *
 *   POST /research { "topic": "..." }  → LLM research brief (paid)
 *   GET  /health                       → free
 *
 * Run: node research-agent.mjs   (needs ANTHROPIC_API_KEY + RESEARCH_PAYTO)
 */
import 'dotenv/config'
import express from 'express'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { startSeller, requireEnv } from './seller-runtime.mjs'

const MODEL = process.env.RESEARCH_MODEL || 'claude-sonnet-5'
if (!process.env.ANTHROPIC_API_KEY) requireEnv('ANTHROPIC_API_KEY')

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'research' }))

app.post('/research', async (req, res) => {
  const topic = req.body?.topic
  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: 'Request body must include a string "topic".' })
  }
  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: z.object({
        topic: z.string(),
        summary: z.string().describe('2-4 sentence overview'),
        keyFindings: z.array(z.string()).describe('3-5 concrete findings'),
        sources: z
          .array(z.object({ title: z.string(), note: z.string() }))
          .describe('2-4 representative sources with why-relevant notes'),
      }),
      prompt:
        `You are a research agent. Produce a concise, well-structured research brief on: "${topic}". ` +
        'Base it on widely-known information; the sources are representative pointers, not live citations.',
    })
    res.json({ agent: 'research-agent', model: MODEL, ...object })
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) })
  }
})

await startSeller({
  name: process.env.RESEARCH_NAME || 'Research Agent',
  app,
  backendPort: Number(process.env.RESEARCH_BACKEND_PORT || 5101),
  proxyPort: Number(process.env.RESEARCH_PROXY_PORT || 4501),
  payTo: requireEnv('RESEARCH_PAYTO'),
  price: process.env.RESEARCH_PRICE || '0.01',
  description: 'LLM research agent — POST /research {topic} returns a sourced brief.',
  tags: ['ai', 'research', 'agent'],
  agentId: process.env.RESEARCH_AGENT_ID,
})
