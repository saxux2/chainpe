/**
 * Register all 6 ChainPe agents on-chain in one shot.
 *
 * Each agent gets its own ERC-8004 identity auto-minted, then is
 * registered in the ChainPeRegistry. Reads wallet keys and addresses
 * from .env — run gen-wallets.mjs + fund-sellers.mjs first.
 *
 * Run: node register-all.mjs
 *
 * Pass --public-base <url> to register with a public URL instead of localhost,
 * e.g. node register-all.mjs --public-base https://myserver.example.com
 */
import 'dotenv/config'
import { parseNetwork, explorerTxUrl } from '@chainpe/sdk'
import {
  ChainPeRegistryClient,
  mintAgentIdentity,
  hasIdentity,
  resolveIdentityRegistry,
} from '@chainpe/cli'

// ── Config ────────────────────────────────────────────────────────────────────

const NETWORK  = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')
const REGISTRY = process.env.CHAINPE_REGISTRY_ADDRESS
if (!REGISTRY) {
  console.error('Set CHAINPE_REGISTRY_ADDRESS (see docs/DEPLOYMENTS.md).')
  process.exit(1)
}
const IDENTITY = resolveIdentityRegistry(NETWORK)

const args = process.argv.slice(2)
const baseIdx = args.indexOf('--public-base')
const publicBase = baseIdx >= 0 ? args[baseIdx + 1] : null

// Each agent: { label, key, payto, name, description, tags, price, proxyPort }
const AGENTS = [
  {
    label:       'Research Agent',
    key:         process.env.RESEARCH_PAYTO_KEY,
    payto:       process.env.RESEARCH_PAYTO,
    name:        'Research Agent',
    description: 'LLM research agent — POST /research {topic} returns a sourced brief.',
    tags:        ['ai', 'research', 'agent'],
    price:       process.env.RESEARCH_PRICE || '0.01',
    proxyPort:   process.env.RESEARCH_PROXY_PORT || '4501',
  },
  {
    label:       'News Digest Agent',
    key:         process.env.DIGEST_PAYTO_KEY,
    payto:       process.env.DIGEST_PAYTO,
    name:        'News Digest Agent',
    description: 'LLM news-digest agent — POST /summarize {text} returns a summary + bullets.',
    tags:        ['ai', 'news', 'summarize', 'agent'],
    price:       process.env.DIGEST_PRICE || '0.01',
    proxyPort:   process.env.DIGEST_PROXY_PORT || '4502',
  },
  {
    label:       'Arbitrum Price Agent',
    key:         process.env.PRICE_PAYTO_KEY,
    payto:       process.env.PRICE_PAYTO,
    name:        'Arbitrum Price Agent',
    description: 'Live ETH and ARB prices, Arbitrum TVL, and top Arbitrum DeFi protocols and yields.',
    tags:        ['arbitrum', 'eth', 'arb', 'price', 'defi', 'data'],
    price:       process.env.PRICE_PRICE || '0.005',
    proxyPort:   process.env.PRICE_PROXY_PORT || '4503',
  },
  {
    label:       'Arbitrum News Agent',
    key:         process.env.NEWS_PAYTO_KEY,
    payto:       process.env.NEWS_PAYTO,
    name:        'Arbitrum News Agent',
    description: 'Latest Arbitrum ecosystem news, LLM-synthesized into investment signals.',
    tags:        ['arbitrum', 'news', 'research'],
    price:       process.env.NEWS_PRICE || '0.02',
    proxyPort:   process.env.NEWS_PROXY_PORT || '4504',
  },
  {
    label:       'Arbitrum Analysis Agent',
    key:         process.env.ANALYSIS_PAYTO_KEY,
    payto:       process.env.ANALYSIS_PAYTO,
    name:        'Arbitrum Analysis Agent',
    description: 'Claude-powered ETH/USDC analysis on Arbitrum: BUY/SELL/HOLD with price targets.',
    tags:        ['arbitrum', 'eth', 'analysis', 'trading', 'ai'],
    price:       process.env.ANALYSIS_PRICE || '0.05',
    proxyPort:   process.env.ANALYSIS_PROXY_PORT || '4505',
  },
  {
    label:       'Arbitrum DEX Agent',
    key:         process.env.DEX_PAYTO_KEY,
    payto:       process.env.DEX_PAYTO,
    name:        'Arbitrum DEX Agent',
    description: 'Best-route swap quotes on Arbitrum One (USDC, USDT0, ETH, ARB, WBTC) via the KyberSwap aggregator.',
    tags:        ['arbitrum', 'dex', 'swap', 'quote', 'trading'],
    price:       process.env.DEX_PRICE || '0.01',
    proxyPort:   process.env.DEX_PROXY_PORT || '4506',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const registryClient = new ChainPeRegistryClient(NETWORK, REGISTRY)

async function mintIdentity(sellerKey, payto, label) {
  if (await hasIdentity({ network: NETWORK, identityRegistry: IDENTITY, ownerAddress: payto })) {
    console.log(`    ℹ  ${label}: wallet already has an ERC-8004 identity — skipping mint`)
    return '0'
  }
  const { agentId, txHash } = await mintAgentIdentity({
    network: NETWORK,
    privateKey: sellerKey,
    identityRegistry: IDENTITY,
    agentURI: `chainpe://agent/${label.toLowerCase().replace(/ /g, '-')}`,
  })
  console.log(`    ✓  ERC-8004 identity minted: agent #${agentId}`)
  console.log(`       tx: ${explorerTxUrl(NETWORK, txHash)}`)
  return agentId
}

// ── Main ──────────────────────────────────────────────────────────────────────

const fee = await registryClient.registrationFee().catch(() => 0n)
console.log(`\nChainPe Registry: ${REGISTRY}`)
console.log(`Registration fee: ${Number(fee) / 1e6} USDC per agent`)
console.log(`Agents to register: ${AGENTS.length}`)
console.log(publicBase ? `Public base URL: ${publicBase}` : 'Using localhost endpoints')

let passed = 0, failed = 0

for (const agent of AGENTS) {
  const { label, key, payto, name, description, tags, price, proxyPort } = agent

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Registering: ${label}`)
  console.log(`  Wallet: ${payto}`)
  console.log(`  Price:  ${price} USDC/call`)

  if (!key || !payto) {
    console.log(`  ✗ Missing key or payto address in .env — skipping`)
    failed++
    continue
  }

  const endpoint = publicBase
    ? `${publicBase.replace(/\/$/, '')}:${proxyPort}`
    : `http://localhost:${proxyPort}`

  console.log(`  Endpoint: ${endpoint}`)

  try {
    // Step 1: Mint ERC-8004 identity (seller signs with their own key)
    const agentId = await mintIdentity(key, payto, label)

    // Step 2: Register in ChainPeRegistry (seller signs)
    const alreadyExists = await registryClient.hasService(payto, name).catch(() => false)
    const result = await registryClient.registerService({
      privateKey: key,
      name,
      description,
      tags,
      endpoint,
      pricePerRequest: price,
      paymentToken: 'USDC',
      walletAddress: payto,
      network: NETWORK,
      agentId,
      isUpdate: alreadyExists,
    })

    console.log(`  ✓  ${alreadyExists ? 'Updated' : 'Registered'} on-chain!  agentId=${agentId}`)
    console.log(`     tx: ${explorerTxUrl(NETWORK, result.txnHash)}`)
    passed++
  } catch (err) {
    console.log(`  ✗  Failed: ${err?.message || err}`)
    failed++
  }
}

console.log(`\n${'═'.repeat(60)}`)
console.log(`Registration complete: ${passed} succeeded, ${failed} failed`)

if (passed > 0) {
  console.log(`\nVerify on-chain:`)
  console.log(`  chainpe discover arbitrum -n ${NETWORK}`)
  console.log(`  node investment-orchestrator.mjs`)
}
console.log()
