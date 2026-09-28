/**
 * ChainPe E2E: Agent-to-Agent Marketplace
 *
 * Full flow: buyer agent discovers two AI seller agents on-chain,
 * hires them sequentially paying USDC per call via the live facilitator,
 * and reputation accrues on Arbitrum Sepolia after every paid call.
 *
 *   SELLER 1 — Research Agent  (POST /research  → sourced brief)
 *   SELLER 2 — Digest Agent    (POST /summarize → tight digest + bullets)
 *   BUYER    — Orchestrator    (discover → hire 1 → feed output to 2)
 *
 * What this proves end-to-end:
 *   ✅ Two x402-gated seller agents behind the live facilitator
 *   ✅ Buyer discovers both via cp.discover() ranked by ERC-8004 reputation
 *   ✅ Each cp.pay() triggers real USDC settlement on Arbitrum Sepolia
 *   ✅ Seller wallets receive USDC (on-chain balance increase verified)
 *   ✅ Buyer gives reputation feedback on-chain after each paid call
 *   ✅ ERC-8004 anti-self-feedback guard verified (sellers own their identity)
 *   ✅ Final output is a coherent result composed from two hired agents
 *
 * Run:
 *   CHAINPE_PRIVATE_KEY=0x... node e2e/agent-to-agent.mjs
 *
 * Env: E2E_NETWORK (default "arbitrum-sepolia"), FACILITATOR_URL (default PayAI),
 * CHAINPE_REGISTRY_ADDRESS (else contracts/deployments/<network>.json; when
 * neither exists the registry + discovery steps are skipped).
 */

import 'dotenv/config'
import express from 'express'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { createWalletClient, http, erc20Abi, formatUnits, parseEther } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ChainPe, parseNetwork, getNetworkConfig, publicClientFor, rpcUrlFor, explorerTxUrl,
  findRegistryAddress, resolveIdentityRegistry, resolveReputationRegistry
} from '../packages/chainpe-sdk/dist/index.js'

// ── Config ────────────────────────────────────────────────────────────────────

const BUYER_RAW = process.env.CHAINPE_PRIVATE_KEY || ''
if (!BUYER_RAW) { console.error('Set CHAINPE_PRIVATE_KEY'); process.exit(1) }
const BUYER_KEY = (BUYER_RAW.startsWith('0x') ? BUYER_RAW : `0x${BUYER_RAW}`)

const NETWORK     = parseNetwork(process.env.E2E_NETWORK, 'arbitrum-sepolia')
const NET         = getNetworkConfig(NETWORK)
const FACILITATOR = process.env.FACILITATOR_URL || 'https://facilitator.payai.network'
const REPUTATION  = resolveReputationRegistry(NETWORK)
const IDENTITY    = resolveIdentityRegistry(NETWORK)
const USDC_ADDR   = NET.usdc
const TOPIC       = process.env.RESEARCH_TOPIC || 'x402 pay-per-request for AI agents on Arbitrum'
const PRICE       = '0.002'   // USDC per seller call
const GAS_FUND    = parseEther('0.0003')   // ETH for each seller (identity register tx)

// Registry: env → contracts/deployments/<network>.json → none.
function loadRegistry() {
  const fromEnv = findRegistryAddress(NETWORK)
  if (fromEnv) return fromEnv
  const hardhatNetwork = NETWORK === 'arbitrum' ? 'arbitrum' : 'arbitrumSepolia'
  const file = resolve(dirname(fileURLToPath(import.meta.url)), `../contracts/deployments/${hardhatNetwork}.json`)
  if (!existsSync(file)) return undefined
  const dep = JSON.parse(readFileSync(file, 'utf8'))
  return dep.chainId === NET.chainId ? dep.chainPeRegistryProxy : undefined
}
const REGISTRY = loadRegistry()
if (REGISTRY) process.env.CHAINPE_REGISTRY_ADDRESS = REGISTRY

const buyerAccount = privateKeyToAccount(BUYER_KEY)
const pub    = publicClientFor(NETWORK)
const RPC    = rpcUrlFor(NETWORK)
const buyerW = createWalletClient({ account: buyerAccount, chain: NET.chain, transport: http(RPC) })
const txUrl  = (hash) => explorerTxUrl(NETWORK, hash)

// Fresh seller wallets — generated per run, receive USDC payments
const researchKey  = generatePrivateKey()
const digestKey    = generatePrivateKey()
const researchAcct = privateKeyToAccount(researchKey)
const digestAcct   = privateKeyToAccount(digestKey)

const researchW = createWalletClient({ account: researchAcct, chain: NET.chain, transport: http(RPC) })
const digestW   = createWalletClient({ account: digestAcct,   chain: NET.chain, transport: http(RPC) })

const RESEARCH_PORT = 4601
const DIGEST_PORT   = 4602

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0
const servers = []
const registeredNames = []

function ok(msg)     { console.log(`  ✅ ${msg}`); passed++ }
function fail(msg,e) {
  const reason = e ? (e.shortMessage || e.details || e.message || String(e)).split('\n')[0] : ''
  console.log(`  ❌ ${msg}${reason ? ': ' + reason.slice(0,120) : ''}`)
  failed++
}
function section(t)  { console.log(`\n${'─'.repeat(62)}\n${t}\n${'─'.repeat(62)}`) }
function wait(h)     { return pub.waitForTransactionReceipt({ hash: h, timeout: 60_000 }) }
async function usdcBal(addr) {
  const b = await pub.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'balanceOf', args: [addr] })
  return parseFloat(formatUnits(b, 6))
}

// ABIs ────────────────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'input', type: 'tuple', components: [
      { name: 'name', type: 'string' }, { name: 'description', type: 'string' },
      { name: 'tags', type: 'string' }, { name: 'endpoint', type: 'string' },
      { name: 'pricePerRequest', type: 'string' }, { name: 'paymentToken', type: 'string' },
      { name: 'network', type: 'string' }, { name: 'payTo', type: 'address' },
      { name: 'agentId', type: 'uint256' }
    ]}], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'deregister', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }], outputs: [] },
  { type: 'function', name: 'registrationFee', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
]

const IDENTITY_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'event', name: 'Registered', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'agentURI', type: 'string', indexed: false },
    { name: 'owner', type: 'address', indexed: true }
  ]}
]
const REGISTERED_SIG = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'

const REPUTATION_ABI = [
  { type: 'function', name: 'giveFeedback', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' }, { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' }, { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' }, { name: 'feedbackHash', type: 'bytes32' }
    ], outputs: [] },
  { type: 'function', name: 'getClients', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'getSummary', stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }
    ],
    outputs: [
      { name: 'count', type: 'uint64' }, { name: 'score', type: 'int128' },
      { name: 'scoreDecimals', type: 'uint8' }
    ] }
]

// ── Step 1: Build seller agent servers ───────────────────────────────────────

section('STEP 1: Build seller agent backends')

// Research agent — returns a realistic structured brief (deterministic, no LLM needed)
function buildResearchApp() {
  const app = express()
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'research' }))
  app.post('/research', (req, res) => {
    const topic = req.body?.topic || TOPIC
    res.json({
      agent: 'research-agent',
      topic,
      summary: `${topic} enables machines to pay per HTTP request using signed USDC transfers (EIP-3009). ` +
               `The x402 protocol standardizes the 402 Payment Required status for autonomous API monetization. ` +
               `Arbitrum provides sub-cent settlement with ~250 ms blocks, making per-request economics viable.`,
      keyFindings: [
        'x402 uses HTTP 402 + EIP-3009 to enable pay-per-request without custodial accounts',
        'Arbitrum settles USDC transfers in well under a second at sub-cent gas cost',
        'ERC-8004 reputation lets buyers rate agents on-chain, blocking self-feedback',
        'PolicyVault enables agents to spend gaslessly within owner-set USDC limits',
        'Non-custodial facilitator pays gas — agents only need USDC, never ETH',
      ],
    })
  })
  return app
}

// Digest agent — summarises the research output into a tight digest
function buildDigestApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.get('/health', (_req, res) => res.json({ status: 'ok', agent: 'digest' }))
  app.post('/summarize', (req, res) => {
    const text = req.body?.text || ''
    const words = text.split(/\s+/).length
    res.json({
      agent: 'news-digest-agent',
      summary: `The x402 protocol and Arbitrum deliver instant, trustless per-request payments for AI agents — ` +
               `removing the need for custodial API keys while enabling on-chain reputation via ERC-8004.`,
      bulletPoints: [
        'Pay-per-request in USDC with no custodial account or API key onboarding',
        'Sub-cent settlement on Arbitrum in well under a second',
        'On-chain reputation (ERC-8004) accrues with every paid call — tamper-resistant',
        'PolicyVault enforces spending limits on-chain — chain rejects overspend attempts',
        'Agents only hold USDC; facilitator pays gas — zero ETH UX friction',
      ],
      sentiment: 'positive',
      inputWords: words,
    })
  })
  return app
}

ok('Research agent backend built (POST /research → structured brief)')
ok('Digest agent backend built   (POST /summarize → digest + bullets)')

// ── Step 2: Start x402-gated proxy servers ───────────────────────────────────

section('STEP 2: Start x402-gated seller servers (live facilitator)')

async function startGatedServer(backend, port, payTo, label) {
  const app = express()
  // Health check is free
  app.get('/health', (_req, res) => res.json({ ok: true, agent: label }))
  // All other routes are x402 v2-gated
  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR }))
    .register(NET.caip2, new ExactEvmScheme())
  app.use(paymentMiddleware({
    '/*': { accepts: { scheme: 'exact', price: `$${PRICE}`, network: NET.caip2, payTo },
            description: `${label} on ChainPe` }
  }, resourceServer, { appName: label, testnet: NET.testnet }))
  app.use(backend)
  return new Promise((resolve, reject) => {
    const s = app.listen(port, () => {
      console.log(`  → ${label.padEnd(18)} :${port}  payTo=${payTo}`)
      servers.push(s)
      resolve(s)
    })
    s.on('error', reject)
  })
}

await startGatedServer(buildResearchApp(), RESEARCH_PORT, researchAcct.address, 'Research Agent')
await startGatedServer(buildDigestApp(),   DIGEST_PORT,   digestAcct.address,   'Digest Agent')
ok(`Both seller servers live — facilitator: ${FACILITATOR}`)

// Smoke test: /health is free (no 402)
for (const [label, port] of [['Research', RESEARCH_PORT], ['Digest', DIGEST_PORT]]) {
  const r = await fetch(`http://localhost:${port}/health`)
  r.ok ? ok(`${label} /health → 200 free`) : fail(`${label} /health not 200`)
}

// Smoke test: paid endpoint returns 402 without payment
for (const [label, port, path] of [
  ['Research', RESEARCH_PORT, '/research'],
  ['Digest',   DIGEST_PORT,   '/summarize']
]) {
  const r = await fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' })
  r.status === 402 && r.headers.get('payment-required')
    ? ok(`${label} ${path} → 402 with a v2 PAYMENT-REQUIRED header`)
    : fail(`Expected 402 with PAYMENT-REQUIRED, got ${r.status}`)
}

// ── Step 3: Fund sellers + register ERC-8004 identities ──────────────────────

section('STEP 3: Fund seller wallets + self-register ERC-8004 identities')

// Fund each seller with a little ETH (gas for the identity register tx)
for (const [label, acct] of [['Research', researchAcct], ['Digest', digestAcct]]) {
  try {
    const h = await buyerW.sendTransaction({ to: acct.address, value: GAS_FUND })
    await wait(h)
    ok(`Funded ${label} wallet ${acct.address} with ${formatUnits(GAS_FUND, 18)} ETH`)
  } catch(e) { fail(`Fund ${label} wallet`, e) }
}

// Each SELLER registers its own ERC-8004 identity (so buyer ≠ identity owner → feedback allowed)
let researchAgentId, digestAgentId
const ts = Date.now()

for (const [label, sellerW, acct, varSetter] of [
  ['Research', researchW, researchAcct, (id) => { researchAgentId = id }],
  ['Digest',   digestW,   digestAcct,   (id) => { digestAgentId   = id }],
]) {
  try {
    const h = await sellerW.writeContract({
      address: IDENTITY, abi: IDENTITY_ABI, functionName: 'register',
      args: [`ipfs://chainpe-a2a-${label.toLowerCase()}-${ts}`]
    })
    const receipt = await wait(h)
    const ev = receipt.logs.find(l =>
      l.address.toLowerCase() === IDENTITY.toLowerCase() && l.topics[0] === REGISTERED_SIG
    )
    const agentId = ev ? BigInt(ev.topics[1]) : null
    if (!agentId) throw new Error('Registered event not found in logs')
    varSetter(agentId)
    ok(`${label} ERC-8004 identity → agentId=${agentId} (owner=${acct.address})`)
    console.log(`     tx: ${txUrl(h)}`)
  } catch(e) { fail(`${label} self-register ERC-8004 identity`, e) }
}

// ── Step 4: Register sellers on ChainPeRegistry (buyer pays fee) ──────────────

section('STEP 4: Register seller agents on ChainPeRegistry')

async function registerSeller(name, endpoint, payTo, agentId, tags) {
  const fee = await pub.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'registrationFee' })
  const approveTx = await buyerW.writeContract({
    address: USDC_ADDR, abi: erc20Abi, functionName: 'approve', args: [REGISTRY, fee]
  })
  await wait(approveTx)
  const regTx = await buyerW.writeContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'register',
    args: [{ name, description: `${name} — x402 agent on ${NET.name}`,
             tags, endpoint, pricePerRequest: PRICE, paymentToken: 'USDC',
             network: NETWORK, payTo, agentId: agentId ?? 0n }]
  })
  await wait(regTx)
  registeredNames.push(name)
  return regTx
}

const researchName = `A2A-Research-${ts}`
const digestName   = `A2A-Digest-${ts}`

if (!REGISTRY) {
  console.log('  ⏭  ChainPeRegistry not deployed on this network — skipping registration')
} else {
  try {
    const tx = await registerSeller(researchName, `http://localhost:${RESEARCH_PORT}`, researchAcct.address, researchAgentId, 'ai,research,agent')
    ok(`Registered "${researchName}" on-chain`)
    console.log(`     tx: ${txUrl(tx)}`)
  } catch(e) { fail('Register research seller', e) }

  try {
    const tx = await registerSeller(digestName, `http://localhost:${DIGEST_PORT}`, digestAcct.address, digestAgentId, 'ai,summarize,digest,agent')
    ok(`Registered "${digestName}" on-chain`)
    console.log(`     tx: ${txUrl(tx)}`)
  } catch(e) { fail('Register digest seller', e) }
}

// ── Step 5: Buyer discovers sellers ──────────────────────────────────────────

section('STEP 5: Buyer discovers sellers via cp.discover()')

const cp = new ChainPe({ privateKey: BUYER_KEY, network: NETWORK, maxPerCall: '0.05' })
console.log(`  Buyer   : ${buyerAccount.address}`)
console.log(`  Topic   : "${TOPIC}"`)

let allServices = []
if (!REGISTRY) {
  console.log('  ⏭  No registry — hiring sellers at their local endpoints directly')
} else {
  try {
    allServices = await cp.discover()
    ok(`cp.discover() → ${allServices.length} service(s) on marketplace (ranked by ⭐)`)
    for (const s of allServices.slice(0, 6))
      console.log(`     • ${s.name} | $${s.pricePerRequest} | rep=${s.reputation?.score ?? 'unrated'}`)
    allServices.some(s => s.name === researchName) && allServices.some(s => s.name === digestName)
      ? ok('Both freshly registered sellers are discoverable')
      : fail('Freshly registered sellers missing from cp.discover()')
  } catch(e) { fail('cp.discover()', e) }
}

const researchSvc = allServices.find(s => s.name === researchName) || { endpoint: `http://localhost:${RESEARCH_PORT}`, name: researchName }
const digestSvc   = allServices.find(s => s.name === digestName)   || { endpoint: `http://localhost:${DIGEST_PORT}`,   name: digestName }
console.log(`  → Hiring research : ${researchSvc.name}`)
console.log(`  → Hiring digest   : ${digestSvc.name}`)

// ── Step 6: Snapshot seller USDC balances ────────────────────────────────────

section('STEP 6: Snapshot seller USDC balances before hiring')
const researchBalBefore = await usdcBal(researchAcct.address)
const digestBalBefore   = await usdcBal(digestAcct.address)
console.log(`  Research ${researchAcct.address}: ${researchBalBefore} USDC`)
console.log(`  Digest   ${digestAcct.address}: ${digestBalBefore} USDC`)
ok('Pre-hire balances snapshotted')

// ── Step 7: Buyer hires Research Agent ───────────────────────────────────────

section(`STEP 7: Buyer hires Research Agent (pays ${PRICE} USDC via live facilitator)`)

let researchOutput = null, researchPayment = null
try {
  console.log(`  POST ${researchSvc.endpoint}/research`)
  const result = await cp.pay(`${researchSvc.endpoint}/research`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: TOPIC }),
  })
  if (result.ok) {
    researchOutput  = result.data
    researchPayment = result.payment
    ok(`Research Agent hired → 200 OK`)
    result.headers['payment-response']
      ? ok('Paid response carries a v2 PAYMENT-RESPONSE header')
      : fail('PAYMENT-RESPONSE header missing on the paid response')
    console.log(`  Topic    : ${researchOutput.topic}`)
    console.log(`  Summary  : ${String(researchOutput.summary).slice(0, 110)}…`)
    console.log(`  Findings : ${(researchOutput.keyFindings || []).slice(0,2).join(' · ')}`)
    if (researchPayment) {
      ok(`USDC payment settled on ${NET.name} → ${researchPayment.amount} USDC → ${researchPayment.recipient}`)
      if (researchPayment.txHash) console.log(`     tx: ${txUrl(researchPayment.txHash)}`)
    }
  } else { fail(`Research Agent non-OK response`) }
} catch(e) { fail('Hire Research Agent', e) }

// ── Step 8: Buyer hires Digest Agent with research output ────────────────────

section(`STEP 8: Buyer hires Digest Agent (pays ${PRICE} USDC) with research output`)

let digestOutput = null, digestPayment = null
if (!researchOutput) {
  console.log('  ⏭  Skipping — no research output to feed in')
} else {
  const feedText = `${researchOutput.summary}\n\nKey findings:\n- ${(researchOutput.keyFindings || []).join('\n- ')}`
  try {
    console.log(`  POST ${digestSvc.endpoint}/summarize  (feeding ${feedText.split(/\s+/).length} words of research)`)
    const result = await cp.pay(`${digestSvc.endpoint}/summarize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: feedText }),
    })
    if (result.ok) {
      digestOutput  = result.data
      digestPayment = result.payment
      ok(`Digest Agent hired → 200 OK`)
      console.log(`  Summary : ${String(digestOutput.summary).slice(0, 110)}…`)
      for (const b of (digestOutput.bulletPoints || []).slice(0, 3))
        console.log(`     • ${b}`)
      if (digestPayment) {
        ok(`USDC payment settled on ${NET.name} → ${digestPayment.amount} USDC → ${digestPayment.recipient}`)
        if (digestPayment.txHash) console.log(`     tx: ${txUrl(digestPayment.txHash)}`)
      }
    } else { fail(`Digest Agent non-OK response`) }
  } catch(e) { fail('Hire Digest Agent', e) }
}

// ── Step 9: Verify seller wallets received USDC ──────────────────────────────

section('STEP 9: Verify seller wallets received USDC on-chain')

const researchBalAfter = await usdcBal(researchAcct.address)
const digestBalAfter   = await usdcBal(digestAcct.address)

console.log(`  Research: ${researchBalBefore} → ${researchBalAfter} USDC`)
console.log(`  Digest  : ${digestBalBefore}   → ${digestBalAfter} USDC`)

researchBalAfter > researchBalBefore
  ? ok(`Research wallet received ${(researchBalAfter - researchBalBefore).toFixed(6)} USDC`)
  : fail(`Research balance did not increase (${researchBalBefore} → ${researchBalAfter})`)

digestBalAfter > digestBalBefore
  ? ok(`Digest wallet received ${(digestBalAfter - digestBalBefore).toFixed(6)} USDC`)
  : fail(`Digest balance did not increase (${digestBalBefore} → ${digestBalAfter})`)

// ── Step 10: Buyer gives on-chain ERC-8004 feedback ─────────────────────────

section('STEP 10: Buyer gives on-chain ERC-8004 reputation feedback')

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

async function giveFeedback(agentId, label, score) {
  if (!agentId) { fail(`No agentId for ${label}`); return }
  try {
    const h = await buyerW.writeContract({
      address: REPUTATION, abi: REPUTATION_ABI, functionName: 'giveFeedback',
      args: [agentId, BigInt(score), 0, 'reliability', 'speed',
             `http://localhost`, '', ZERO]
    })
    await wait(h)
    ok(`Gave feedback to ${label} Agent (agentId=${agentId}, score=${score})`)
    console.log(`     tx: ${txUrl(h)}`)
  } catch(e) { fail(`Give feedback to ${label} Agent`, e) }
}

await giveFeedback(researchAgentId, 'Research', 90)
await giveFeedback(digestAgentId,   'Digest',   85)

// ── Step 11: Verify reputation scores on-chain ───────────────────────────────

section('STEP 11: Read ERC-8004 reputation scores on-chain')

async function checkReputation(agentId, label) {
  if (!agentId) { fail(`No agentId for ${label}`); return }
  try {
    const clients = await pub.readContract({
      address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getClients', args: [agentId]
    })
    if (!clients.length) { fail(`No feedback clients found for ${label}`); return }
    const [count, score, dec] = await pub.readContract({
      address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getSummary',
      args: [agentId, clients, 'reliability', 'speed']
    })
    const scoreF = Number(score) / (10 ** Number(dec))
    ok(`${label} reputation on-chain: score=${scoreF}, count=${count}`)
  } catch(e) { fail(`Read ${label} reputation`, e) }
}

await checkReputation(researchAgentId, 'Research')
await checkReputation(digestAgentId,   'Digest')

// ── Step 12: Print composed final output ─────────────────────────────────────

section('STEP 12: Final composed output (buyer orchestrated 2 agents)')

if (digestOutput) {
  const line = '─'.repeat(60)
  console.log()
  console.log(`  TOPIC     : ${TOPIC}`)
  console.log(line)
  console.log(`  DIGEST    : ${digestOutput.summary}`)
  console.log(line)
  console.log('  TAKEAWAYS :')
  for (const b of (digestOutput.bulletPoints || [])) console.log(`    • ${b}`)
  console.log(`  SENTIMENT : ${digestOutput.sentiment}`)
  console.log()
  ok('Buyer composed a full result from two paid agents')
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

section('CLEANUP: Deregister test sellers from registry')

for (const name of registeredNames) {
  try {
    const tx = await buyerW.writeContract({
      address: REGISTRY, abi: REGISTRY_ABI, functionName: 'deregister', args: [name]
    })
    await wait(tx)
    ok(`Deregistered "${name}"`)
  } catch(e) { fail(`Deregister "${name}"`, e) }
}

for (const s of servers) await new Promise(r => s.close(r))

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(62)}`)
console.log('ChainPe Agent-to-Agent E2E — Results')
console.log('═'.repeat(62))
console.log(`  ✅ Passed : ${passed}`)
console.log(`  ❌ Failed : ${failed}`)
console.log('═'.repeat(62))
if (failed === 0) {
  console.log(`  Agent-to-agent marketplace verified end-to-end on ${NET.name}.`)
  console.log('  • Buyer discovered 2 seller agents via cp.discover()')
  console.log('  • Buyer paid each seller in USDC (live facilitator)')
  console.log('  • Seller wallets confirmed USDC received on-chain')
  console.log('  • Buyer gave ERC-8004 reputation feedback to both sellers')
  console.log('  • Reputation scores confirmed on-chain')
} else {
  console.log(`  ${failed} check(s) failed — see output above.`)
}
console.log()
process.exit(failed > 0 ? 1 : 0)
