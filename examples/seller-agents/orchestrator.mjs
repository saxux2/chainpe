/**
 * Buyer orchestrator — agent hires agents.
 *
 * Discovers the seller agents on the ChainPe marketplace (ranked by ⭐ ERC-8004
 * reputation), then HIRES BOTH IN SEQUENCE, paying each in USDC on Arbitrum:
 *   1. research-agent  → a sourced brief on the topic
 *   2. news-digest-agent → a tight digest of that brief
 * With autoFeedback on, each paid call also bumps the seller's on-chain reputation.
 *
 * Run: node orchestrator.mjs "your topic here"   (needs CHAINPE_PRIVATE_KEY)
 */
import 'dotenv/config'
import { ChainPe, parseNetwork, explorerTxUrl } from '@chainpe/sdk'

const privateKey = process.env.CHAINPE_PRIVATE_KEY || process.env.BUYER_KEY
if (!privateKey) {
  console.error('Set CHAINPE_PRIVATE_KEY (the buyer wallet; needs a little USDC — https://faucet.circle.com for Arbitrum Sepolia).')
  process.exit(1)
}
const network = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')
const topic = process.argv.slice(2).join(' ') || 'On-chain agent payments on Arbitrum in 2026'

const cp = new ChainPe({ privateKey, network, autoFeedback: true })

function pick(services, tags, overrideUrl, label) {
  if (overrideUrl) return { name: `${label} (override)`, endpoint: overrideUrl, reputation: null, pricePerRequest: '?' }
  // Prefer our own registered sellers over look-alike x402 Bazaar listings.
  const hasTag = (s) => s.tags.some((t) => tags.includes(t.toLowerCase()))
  const match = services.find((s) => s.source === 'registry' && hasTag(s)) ?? services.find(hasTag)
  if (!match) {
    console.error(`No ${label} seller found (tags: ${tags.join(', ')}). Are the seller agents running + registered?`)
    process.exit(1)
  }
  return match
}

function stars(rep) {
  return rep?.score != null ? `⭐ ${rep.score} (${rep.count})` : 'unrated'
}

async function hire(service, path, payload, label) {
  const url = new URL(path, service.endpoint).toString()
  console.log(`\n→ Hiring ${label}: ${service.name}  [${stars(service.reputation)}]`)
  console.log(`  ${url}`)
  const res = await cp.pay(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`${label} returned ${res.status}: ${JSON.stringify(res.data)}`)
  if (res.payment) {
    console.log(`  💸 paid ${res.payment.amount} USDC → ${res.payment.recipient}` + (res.payment.txHash ? `  ${explorerTxUrl(network, res.payment.txHash)}` : ''))
  }
  if (res.reputation) {
    console.log(`  ⭐ rated agent ${res.reputation.agentId} +${res.reputation.score}  tx ${res.reputation.txHash}`)
  }
  return res.data
}

console.log('Buyer wallet:', cp.getAddress(), 'on', network)
console.log('Balance:', await cp.balance())
console.log(`\nTopic: ${topic}`)

// 1. Discover sellers, ranked by reputation.
const all = await cp.discover()
console.log(`\nMarketplace: ${all.length} service(s) discovered (ranked by ⭐).`)
const research = pick(all, ['research'], process.env.RESEARCH_URL, 'research')
const digest = pick(all, ['summarize', 'digest'], process.env.DIGEST_URL, 'digest')

// 2. Hire the research agent.
const brief = await hire(research, '/research', { topic }, 'research agent')

// 3. Feed its output to the digest agent.
const text = `${brief.summary}\n\nKey findings:\n- ${(brief.keyFindings || []).join('\n- ')}`
const digestOut = await hire(digest, '/summarize', { text }, 'digest agent')

// 4. Compose the final result.
console.log('\n──────────────────────────────────────────────')
console.log('FINAL DIGEST')
console.log('──────────────────────────────────────────────')
console.log(digestOut.summary, '\n')
for (const b of digestOut.bulletPoints || []) console.log('  •', b)
console.log('\nDone. Two agents hired, paid in USDC, reputation updated on-chain.')
