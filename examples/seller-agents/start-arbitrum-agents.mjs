/**
 * Start the Arbitrum price, news and DEX sellers and keep them up.
 *
 * Each seller's x402 gateway asks the facilitator for its supported payment
 * kinds once at startup; if that request fails (network blip) every paid call
 * returns 500 until restart. This launcher probes each paid route and restarts
 * a seller that isn't answering 402, and restarts any that crash.
 *
 * Run: npm run agents   (needs PRICE_/NEWS_/DEX_PAYTO in .env; no API keys)
 */
import 'dotenv/config'
import { spawn } from 'node:child_process'

const AGENTS = [
  { name: 'price', script: 'arbitrum-price-agent.mjs', port: process.env.PRICE_PROXY_PORT || 4503, probe: ['GET', '/price'] },
  { name: 'news', script: 'arbitrum-news-agent.mjs', port: process.env.NEWS_PROXY_PORT || 4504, probe: ['POST', '/news'] },
  { name: 'dex', script: 'arbitrum-dex-agent.mjs', port: process.env.DEX_PROXY_PORT || 4506, probe: ['GET', '/tokens'] },
]

const children = new Map()
let stopping = false

function start(agent) {
  const child = spawn(process.execPath, [agent.script], { stdio: 'inherit' })
  children.set(agent.name, child)
  child.on('exit', (code) => {
    if (stopping || children.get(agent.name) !== child) return
    console.log(`[launcher] ${agent.name} exited (${code}); restarting in 3s`)
    setTimeout(() => start(agent), 3000)
  })
}

function restart(agent) {
  const child = children.get(agent.name)
  children.delete(agent.name)
  child?.kill()
  start(agent)
}

/** 402 = gateway ready; anything else (500, refused) = not ready. */
async function ready({ port, probe: [method, path] }) {
  try {
    const r = await fetch(`http://localhost:${port}${path}`, { method, signal: AbortSignal.timeout(5000) })
    return r.status === 402
  } catch {
    return false
  }
}

function shutdown() {
  stopping = true
  for (const child of children.values()) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

AGENTS.forEach(start)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(15_000)
for (;;) {
  for (const agent of AGENTS) {
    if (!(await ready(agent))) {
      console.log(`[launcher] ${agent.name} not answering 402 on :${agent.port}; restarting`)
      restart(agent)
    }
  }
  await sleep(60_000)
}
