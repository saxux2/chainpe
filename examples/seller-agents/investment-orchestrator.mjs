/**
 * Investment Orchestrator — an autonomous ETH/USDC paper-trading fund manager on ChainPe.
 *
 * Discovers and HIRES four specialized agents in sequence, paying each in USDC:
 *   1. arbitrum-price-agent    → live ETH/ARB prices + Arbitrum DeFi TVL
 *   2. arbitrum-news-agent     → latest Arbitrum ecosystem news + sentiment
 *   3. arbitrum-analysis-agent → Claude thesis: BUY/SELL/HOLD ETH + targets
 *   4. arbitrum-dex-agent      → best-route quote on Arbitrum One (if BUY/SELL)
 *
 * Trades are PAPER trades: the orchestrator prices them with the DEX agent's real
 * quote and tracks an in-memory portfolio. Only the agent fees are real payments.
 *
 * Flags:
 *   --cycles N  run N investment cycles (default: 1)
 *
 * Run:
 *   CHAINPE_PRIVATE_KEY=0x... node investment-orchestrator.mjs
 *   CHAINPE_PRIVATE_KEY=0x... node investment-orchestrator.mjs --cycles 3
 */
import 'dotenv/config'
import { ChainPe, parseNetwork, explorerTxUrl } from '@chainpe/sdk'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const cyclesIdx = args.indexOf('--cycles')
const CYCLES = (cyclesIdx >= 0 && Number(args[cyclesIdx + 1])) || 1

const privateKey = process.env.CHAINPE_PRIVATE_KEY || process.env.BUYER_KEY
if (!privateKey) {
  console.error('Set CHAINPE_PRIVATE_KEY (the buyer wallet; needs USDC — https://faucet.circle.com for Arbitrum Sepolia).')
  process.exit(1)
}

const network = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')
const cp = new ChainPe({ privateKey, network, autoFeedback: true, maxPerCall: '0.20' })

// ── Helpers ───────────────────────────────────────────────────────────────────

function header(t) {
  const line = '─'.repeat(64)
  console.log(`\n${line}\n${t}\n${line}`)
}

function paid(label, payment) {
  if (payment) {
    console.log(`  💸 ${label}: paid ${payment.amount} ${payment.token} → ${payment.recipient}`)
    if (payment.txHash) console.log(`     tx: ${explorerTxUrl(network, payment.txHash)}`)
  }
}

function rep(reputation) {
  if (reputation) {
    console.log(`  ⭐ rated agent ${reputation.agentId} +${reputation.score}  tx ${reputation.txHash}`)
  }
}

function pickAgent(services, tags, envUrl, label) {
  if (envUrl) return { name: `${label} (override)`, endpoint: envUrl, reputation: null }
  // Prefer our own registered sellers over look-alike x402 Bazaar listings.
  const hasTag = (s) => s.tags?.some((t) => tags.includes(t.toLowerCase()))
  const match = services.find((s) => s.source === 'registry' && hasTag(s)) ?? services.find(hasTag)
  if (!match) {
    console.error(
      `  ✗ No ${label} found (tags: ${tags.join(', ')}). ` +
      `Is it running and registered? Or set its *_URL override. See .env.example.`
    )
    return null
  }
  return match
}

function stars(rep) {
  if (rep?.score == null) return 'unrated'
  return `⭐ ${rep.score} (${rep.count} ratings${rep.verified ? ', verified' : ''})`
}

// ── Portfolio state (in-memory across cycles) ─────────────────────────────────

const portfolio = {
  usdcBalance: Number(process.env.PORTFOLIO_USDC ?? '10.0'),
  ethAmount: Number(process.env.PORTFOLIO_ETH ?? '0'),
  trades: [],
  totalPaid: 0,
}

// ── Main investment loop ──────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════')
console.log(`  ChainPe Investment Orchestrator — ${network}`)
console.log('════════════════════════════════════════════════════════════════')
console.log(`  Buyer wallet : ${cp.getAddress()}`)
const bal = await cp.balance()
console.log(`  USDC balance : ${bal.usdc} USDC`)
console.log(`  ETH balance  : ${bal.eth} ETH`)
console.log(`  Mode         : 🟡 PAPER TRADING (agent fees are real, trades are simulated)`)
console.log(`  Cycles       : ${CYCLES}`)

// Discover all agents once at the start
header('DISCOVERY: Finding agents (ChainPe registry + x402 Bazaar + ERC-8004)')
const allServices = await cp.discover({ tags: ['arbitrum'] })
console.log(`  Found ${allServices.length} service(s), ranked by ⭐ reputation.`)
for (const s of allServices.slice(0, 8)) {
  console.log(`  • ${s.name.padEnd(28)} $${s.pricePerRequest}/call  ${stars(s.reputation)}  [${s.source}]`)
}

const priceAgent    = pickAgent(allServices, ['price', 'defi'], process.env.PRICE_URL,    'Price Agent')
const newsAgent     = pickAgent(allServices, ['news'],          process.env.NEWS_URL,     'News Agent')
const analysisAgent = pickAgent(allServices, ['analysis'],      process.env.ANALYSIS_URL, 'Analysis Agent')
const dexAgent      = pickAgent(allServices, ['dex', 'quote'],  process.env.DEX_URL,      'DEX Agent')

if (!priceAgent || !newsAgent || !analysisAgent) {
  console.error('\n  ✗ Missing required agents. Start them (launch.sh) and register them (register-all.mjs).')
  process.exit(1)
}

// ── Investment cycles ─────────────────────────────────────────────────────────

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  header(`CYCLE ${cycle}/${CYCLES} — ${new Date().toISOString()}`)
  console.log(`  Portfolio: ${portfolio.ethAmount.toFixed(6)} ETH + $${portfolio.usdcBalance.toFixed(2)} USDC`)

  let priceData = null
  let newsData = null
  let analysis = null

  // ── Step 1: Live prices ────────────────────────────────────────────────────
  console.log(`\n[1/4] Hiring ${priceAgent.name}  [${stars(priceAgent.reputation)}]`)
  try {
    const res = await cp.pay(`${priceAgent.endpoint}/price`)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
    priceData = res.data
    paid('Price data', res.payment)
    rep(res.reputation)
    portfolio.totalPaid += Number(res.payment?.amount ?? 0)

    if (priceData.eth) {
      console.log(`  ETH: $${priceData.eth.usd}  24h: ${priceData.eth.change24h?.toFixed(2)}%`)
      console.log(`  ARB: $${priceData.arb?.usd}  24h: ${priceData.arb?.change24h?.toFixed(2)}%`)
      console.log(`  Arbitrum TVL: $${priceData.arbitrumTvl ? (priceData.arbitrumTvl / 1e9).toFixed(2) + 'B' : '?'}`)
    }
  } catch (err) {
    console.error(`  ✗ Price agent failed: ${err.message}`)
  }

  // ── Step 2: Arbitrum news ──────────────────────────────────────────────────
  console.log(`\n[2/4] Hiring ${newsAgent.name}  [${stars(newsAgent.reputation)}]`)
  try {
    const res = await cp.pay(`${newsAgent.endpoint}/news`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 8 }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
    newsData = res.data
    paid('News digest', res.payment)
    rep(res.reputation)
    portfolio.totalPaid += Number(res.payment?.amount ?? 0)

    if (newsData) {
      console.log(`  Sentiment : ${newsData.sentiment?.toUpperCase()}`)
      console.log(`  Headline  : ${newsData.headline}`)
      for (const kd of (newsData.keyDevelopments ?? []).slice(0, 3)) console.log(`  • ${kd}`)
    }
  } catch (err) {
    console.error(`  ✗ News agent failed: ${err.message}`)
  }

  // ── Step 3: Claude analysis ────────────────────────────────────────────────
  if (priceData || newsData) {
    console.log(`\n[3/4] Hiring ${analysisAgent.name}  [${stars(analysisAgent.reputation)}]`)
    try {
      const res = await cp.pay(`${analysisAgent.endpoint}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ price: priceData, news: newsData, portfolio }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
      analysis = res.data
      paid('Investment analysis', res.payment)
      rep(res.reputation)
      portfolio.totalPaid += Number(res.payment?.amount ?? 0)

      const emoji = { BUY: '🟢', SELL: '🔴', HOLD: '🟡' }[analysis.action] ?? '⚪'
      console.log(`\n  ${emoji} RECOMMENDATION: ${analysis.action} ETH  (confidence: ${analysis.confidence}%)`)
      console.log(`  Rationale  : ${analysis.rationale}`)
      if (analysis.targetEntryUsd) console.log(`  Entry      : $${analysis.targetEntryUsd}`)
      if (analysis.targetExitUsd)  console.log(`  Target     : $${analysis.targetExitUsd}`)
      if (analysis.stopLossUsd)    console.log(`  Stop-loss  : $${analysis.stopLossUsd}`)
      console.log(`  Position   : ${analysis.positionSizePercent}% of portfolio  (${analysis.timeHorizon})`)
      for (const sig of (analysis.technicalSignals ?? []).slice(0, 3)) console.log(`  Signal     : ${sig}`)
      for (const risk of (analysis.keyRisks ?? [])) console.log(`  Risk       : ${risk}`)
    } catch (err) {
      console.error(`  ✗ Analysis agent failed: ${err.message}`)
    }
  }

  // ── Step 4: Price the trade with a real quote ──────────────────────────────
  const shouldTrade = analysis && (analysis.action === 'BUY' || analysis.action === 'SELL')

  if (!dexAgent) {
    console.log('\n[4/4] DEX Agent not available — skipping.')
  } else if (!shouldTrade) {
    console.log(`\n[4/4] Analysis says HOLD — no trade this cycle.`)
  } else {
    const isBuy = analysis.action === 'BUY'
    const fromToken = isBuy ? 'USDC' : 'ETH'
    const toToken   = isBuy ? 'ETH' : 'USDC'
    const swapAmount = isBuy
      ? (portfolio.usdcBalance * analysis.positionSizePercent / 100).toFixed(2)
      : (portfolio.ethAmount  * analysis.positionSizePercent / 100).toFixed(6)

    if (Number(swapAmount) <= 0) {
      console.log(`\n[4/4] Nothing to ${analysis.action} (${fromToken} balance is 0).`)
    } else {
      console.log(`\n[4/4] Hiring ${dexAgent.name}  [${stars(dexAgent.reputation)}]`)
      console.log(`  Paper trade: ${analysis.action} ${swapAmount} ${fromToken} → ${toToken}`)

      try {
        const res = await cp.pay(`${dexAgent.endpoint}/quote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fromToken, toToken, amountIn: swapAmount, slippagePct: 1.0 }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
        const quote = res.data
        paid('DEX quote', res.payment)
        rep(res.reputation)
        portfolio.totalPaid += Number(res.payment?.amount ?? 0)

        console.log(`  From : ${quote.from?.amount} ${quote.from?.token}`)
        console.log(`  To   : ${quote.to?.amount} ${quote.to?.token}  (min ${quote.minReceived})`)
        console.log(`  Route: ${(quote.route ?? []).join(' → ')}  via ${quote.aggregator}`)

        // Apply the quote to the paper portfolio
        const outAmt = Number(quote.to?.amount ?? 0)
        if (isBuy && outAmt > 0) {
          portfolio.usdcBalance -= Number(swapAmount)
          portfolio.ethAmount   += outAmt
        } else if (!isBuy && outAmt > 0) {
          portfolio.ethAmount   -= Number(swapAmount)
          portfolio.usdcBalance += outAmt
        }

        portfolio.trades.push({
          cycle,
          action: analysis.action,
          from: `${swapAmount} ${fromToken}`,
          to: `${outAmt} ${toToken}`,
          rate: quote.rate,
        })
      } catch (err) {
        console.error(`  ✗ DEX agent failed: ${err.message}`)
      }
    }
  }

  // Brief pause between cycles to avoid rate limits on free APIs
  if (cycle < CYCLES) {
    console.log('\n  ⏳ Waiting 5s before next cycle...')
    await new Promise((r) => setTimeout(r, 5000))
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

header('INVESTMENT SESSION SUMMARY')
console.log(`  Final paper portfolio:`)
console.log(`    ETH   : ${portfolio.ethAmount.toFixed(6)} ETH`)
console.log(`    USDC  : $${portfolio.usdcBalance.toFixed(2)}`)
console.log(`  Agent fees paid (real) : $${portfolio.totalPaid.toFixed(4)} USDC`)
console.log(`  Paper trades           : ${portfolio.trades.length}`)
for (const t of portfolio.trades) {
  console.log(`    [Cycle ${t.cycle}] ${t.action} ${t.from} → ${t.to}`)
}
console.log('\n  Agents that earned USDC this session:')
console.log('    ✓ Arbitrum Price Agent    (market data)')
console.log('    ✓ Arbitrum News Agent     (ecosystem news + LLM synthesis)')
console.log('    ✓ Arbitrum Analysis Agent (Claude investment thesis)')
if (portfolio.trades.length > 0) console.log('    ✓ Arbitrum DEX Agent      (best-route quotes)')
console.log()
