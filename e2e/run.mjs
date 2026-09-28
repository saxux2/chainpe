/**
 * ChainPe E2E Test Suite — all production flows against Arbitrum Sepolia.
 *
 * Tests (in order):
 *   FLOW 1  Infrastructure health  — facilitator(s), indexer, registry contract
 *   FLOW 2  Registry read          — on-chain paginated list + indexer API
 *   FLOW 3  x402 payment           — real 402→pay→200 (x402 v2) via a live facilitator
 *   FLOW 4  Discovery              — cp.discover() ranked list from SDK
 *   FLOW 5  Reputation             — canonical ERC-8004 giveFeedback + read back score
 *   FLOW 6  Registry write         — register service, verify in indexer, deregister
 *   FLOW 7  PolicyVault            — deploy vault, gasless spend, overspend rejection
 *
 * Run:
 *   CHAINPE_PRIVATE_KEY=0x... node e2e/run.mjs
 *   CHAINPE_PRIVATE_KEY=0x... FLOWS=1,3,5 node e2e/run.mjs   # selective
 *
 * Env:
 *   CHAINPE_PRIVATE_KEY       test wallet (needs Sepolia ETH + USDC from faucet.circle.com)
 *   E2E_NETWORK               "arbitrum-sepolia" (default) or "arbitrum"
 *   CHAINPE_REGISTRY_ADDRESS  ChainPeRegistry proxy; falls back to
 *                             contracts/deployments/<hardhatNetwork>.json.
 *                             Registry checks are skipped when neither exists.
 *   FACILITATOR_URL           facilitator that settles flow 3 (default: PayAI)
 *   CHAINPE_FACILITATOR_URL   self-hosted ChainPe facilitator to health-check (optional)
 *   INDEXER_URL               ChainPe indexer to check (optional)
 *   ARBITRUM_SEPOLIA_RPC_URL  private RPC (optional)
 *
 * All state is cleaned up: registered services are deregistered, the vault
 * withdraws remaining USDC. Flow 3 spends 0.001 USDC (paid to ourselves),
 * flow 6 pays the registration fee. Flow 7 additionally deploys PolicyVault (gas only).
 */

import { createWalletClient, http, parseUnits, parseEther, formatUnits, formatEther, erc20Abi } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ChainPe, PolicyVaultClient, parseNetwork, getNetworkConfig, publicClientFor, rpcUrlFor,
  explorerTxUrl, findRegistryAddress, resolveIdentityRegistry, resolveReputationRegistry
} from '../packages/chainpe-sdk/dist/index.js'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import express from 'express'

// ── Config ────────────────────────────────────────────────────────────────────

const RAW_KEY = process.env.CHAINPE_PRIVATE_KEY
if (!RAW_KEY) {
  console.error('Set CHAINPE_PRIVATE_KEY (the Arbitrum Sepolia test wallet key, needs USDC + ETH).')
  process.exit(1)
}
const KEY = RAW_KEY.startsWith('0x') ? RAW_KEY : `0x${RAW_KEY}`
const NETWORK = parseNetwork(process.env.E2E_NETWORK, 'arbitrum-sepolia')
const NET     = getNetworkConfig(NETWORK)
const HARDHAT_NETWORK = NETWORK === 'arbitrum' ? 'arbitrum' : 'arbitrumSepolia'

const FACILITATOR         = process.env.FACILITATOR_URL || 'https://facilitator.payai.network'
const CHAINPE_FACILITATOR = process.env.CHAINPE_FACILITATOR_URL
const INDEXER             = process.env.INDEXER_URL
const USDC_ADDR  = NET.usdc
const IDENTITY   = resolveIdentityRegistry(NETWORK)
const REPUTATION = resolveReputationRegistry(NETWORK)

const __dir = dirname(fileURLToPath(import.meta.url))

// Registry: env → contracts/deployments/<network>.json → none (registry checks skipped).
function loadRegistry() {
  const fromEnv = findRegistryAddress(NETWORK)
  if (fromEnv) return fromEnv
  const file = resolve(__dir, `../contracts/deployments/${HARDHAT_NETWORK}.json`)
  if (!existsSync(file)) return undefined
  const dep = JSON.parse(readFileSync(file, 'utf8'))
  return dep.chainId === NET.chainId ? dep.chainPeRegistryProxy : undefined
}
const REGISTRY = loadRegistry()
// The SDK (discover, feedback resolution) reads the registry from env.
if (REGISTRY) process.env.CHAINPE_REGISTRY_ADDRESS = REGISTRY

const account = privateKeyToAccount(KEY)
const pub     = publicClientFor(NETWORK)
const wallet  = createWalletClient({ account, chain: NET.chain, transport: http(rpcUrlFor(NETWORK)) })
const tx      = (hash) => explorerTxUrl(NETWORK, hash)

const SELECTED_FLOWS = process.env.FLOWS
  ? new Set(process.env.FLOWS.split(',').map(Number))
  : null

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0, skipped = 0
const results = []

function log(msg)    { console.log(`  ${msg}`) }
function ok(msg)     { log(`✅ ${msg}`); passed++ }
function fail(msg, e){ log(`❌ ${msg}${e ? ': ' + (e.shortMessage || e.message || e) : ''}`); failed++ }
function skip(msg)   { log(`⏭  ${msg}`); skipped++ }

async function flow(n, name, fn) {
  if (SELECTED_FLOWS && !SELECTED_FLOWS.has(n)) return
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`FLOW ${n}: ${name}`)
  console.log('─'.repeat(60))
  try { await fn() }
  catch (e) { fail(`Unhandled error in flow ${n}`, e) }
  results.push({ n, name })
}

async function get(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.json()
}

function wait(hash) { return pub.waitForTransactionReceipt({ hash, timeout: 60_000 }) }
function usdc(amount) { return parseUnits(String(amount), 6) }

// Registry ABI (minimal — just what we need for e2e)
const REGISTRY_ABI = [
  { type: 'function', name: 'getServices', stateMutability: 'view',
    inputs: [{ name: 'offset', type: 'uint256' }, { name: 'limit', type: 'uint256' }],
    outputs: [{ type: 'tuple[]', components: [
      { name: 'name', type: 'string' }, { name: 'description', type: 'string' },
      { name: 'tags', type: 'string' }, { name: 'endpoint', type: 'string' },
      { name: 'pricePerRequest', type: 'string' }, { name: 'paymentToken', type: 'string' },
      { name: 'network', type: 'string' }, { name: 'payTo', type: 'address' },
      { name: 'developer', type: 'address' }, { name: 'agentId', type: 'uint256' },
      { name: 'createdAt', type: 'uint64' }, { name: 'updatedAt', type: 'uint64' },
      { name: 'exists', type: 'bool' }
    ]}, { name: 'total', type: 'uint256' }]
  },
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'input', type: 'tuple', components: [
      { name: 'name', type: 'string' }, { name: 'description', type: 'string' },
      { name: 'tags', type: 'string' }, { name: 'endpoint', type: 'string' },
      { name: 'pricePerRequest', type: 'string' }, { name: 'paymentToken', type: 'string' },
      { name: 'network', type: 'string' }, { name: 'payTo', type: 'address' },
      { name: 'agentId', type: 'uint256' }
    ]}],
    outputs: [{ name: 'serviceKey', type: 'bytes32' }]
  },
  { type: 'function', name: 'deregister', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }], outputs: [] },
  { type: 'function', name: 'registrationFee', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
]

// ERC-8004 ABI (minimal)
const REPUTATION_ABI = [
  { type: 'function', name: 'giveFeedback', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' }, { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' }, { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' }, { name: 'feedbackHash', type: 'bytes32' }
    ], outputs: [] },
  { type: 'function', name: 'getClients', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'getSummary', stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }
    ],
    outputs: [
      { name: 'count', type: 'uint64' }, { name: 'score', type: 'int128' },
      { name: 'scoreDecimals', type: 'uint8' }
    ] },
]

const IDENTITY_ABI = [
  // register(agentURI) → emits Registered(agentId, agentURI, owner)
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'event', name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true }
    ]
  }
]

// PolicyVault bytecode + ABI (from compiled artifact)
const VAULT_ARTIFACT = JSON.parse(
  readFileSync(resolve(__dir, '../contracts/artifacts/contracts/PolicyVault.sol/PolicyVault.json'), 'utf8')
)
const VAULT_BYTECODE = VAULT_ARTIFACT.bytecode
const VAULT_ABI = VAULT_ARTIFACT.abi

console.log(`\nChainPe E2E on ${NET.name} (${NET.caip2})`)
console.log(`  wallet      : ${account.address}`)
console.log(`  facilitator : ${FACILITATOR}`)
console.log(`  registry    : ${REGISTRY ?? '(not deployed — registry checks skipped)'}`)
console.log(`  identity    : ${IDENTITY}`)
console.log(`  reputation  : ${REPUTATION}`)

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 1: Infrastructure Health
// ─────────────────────────────────────────────────────────────────────────────

await flow(1, 'Infrastructure Health', async () => {
  // 1a. Settling facilitator /supported lists exact on this network (x402 v2)
  try {
    const s = await get(`${FACILITATOR}/supported`)
    const kind = s.kinds?.find(k => k.network === NET.caip2 && k.scheme === 'exact' && k.x402Version === 2)
    kind ? ok(`Facilitator /supported → ${NET.caip2} exact (x402 v2)`)
         : fail(`Facilitator ${FACILITATOR} does not list ${NET.caip2} exact v2`)
  } catch(e) { fail('Facilitator /supported', e) }

  // 1b. Self-hosted ChainPe facilitator /health + /status (ETH gas balance)
  if (CHAINPE_FACILITATOR) {
    try {
      const h = await get(`${CHAINPE_FACILITATOR}/health`)
      if (h.status === 'ok' && h.custodial === false && h.x402Networks?.includes(NET.caip2))
        ok(`ChainPe facilitator /health → status=ok, serves ${NET.caip2}, custodial=false`)
      else
        fail('ChainPe facilitator /health unexpected response', JSON.stringify(h))
    } catch(e) { fail('ChainPe facilitator /health', e) }

    try {
      const s = await get(`${CHAINPE_FACILITATOR}/status`)
      const net = s.networks?.find(n => n.x402Network === NET.caip2)
      if (net && net.lowGas === false)
        ok(`ChainPe facilitator /status → gas balance ${parseFloat(net.gasBalanceEth).toFixed(5)} ETH (not low)`)
      else
        fail(`ChainPe facilitator /status → low or unknown gas on ${NETWORK}`, JSON.stringify(net))
    } catch(e) { fail('ChainPe facilitator /status', e) }
  } else {
    skip('CHAINPE_FACILITATOR_URL not set — self-hosted facilitator not checked')
  }

  // 1c. Indexer /health
  if (INDEXER) {
    try {
      const h = await get(`${INDEXER}/health`)
      h.status === 'ok'
        ? ok(`Indexer /health → status=ok`)
        : fail('Indexer /health unexpected', JSON.stringify(h))
    } catch(e) { fail('Indexer /health', e) }
  } else {
    skip('INDEXER_URL not set — indexer not checked')
  }

  // 1d. Wallet balances
  try {
    const [eth, usdcBal] = await Promise.all([
      pub.getBalance({ address: account.address }),
      pub.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
    ])
    const ethF  = parseFloat(formatEther(eth)).toFixed(5)
    const usdcF = parseFloat(formatUnits(usdcBal, 6)).toFixed(4)
    ok(`Wallet ${account.address} → ${ethF} ETH · ${usdcF} USDC on ${NET.name}`)
    if (usdcBal < usdc(1.1)) log(`⚠ Low USDC (${usdcF}) — flow 6 pays the 1 USDC registration fee; flows 3/7 need ~0.06`)
    if (NET.faucetUrl && usdcBal === 0n) log(`   ↳ get test USDC at ${NET.faucetUrl}`)
  } catch(e) { fail('Wallet balance check', e) }

  // 1e. Canonical ERC-8004 registries are deployed
  for (const [label, address] of [['Identity', IDENTITY], ['Reputation', REPUTATION]]) {
    try {
      const code = await pub.getCode({ address })
      code && code !== '0x' ? ok(`ERC-8004 ${label} Registry live at ${address}`) : fail(`No code at ERC-8004 ${label} Registry ${address}`)
    } catch(e) { fail(`ERC-8004 ${label} Registry`, e) }
  }

  // 1f. Registry contract is reachable
  if (REGISTRY) {
    try {
      const fee = await pub.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'registrationFee' })
      ok(`ChainPeRegistry on-chain → registrationFee = ${formatUnits(fee, 6)} USDC`)
    } catch(e) { fail('Registry contract read', e) }
  } else {
    skip('ChainPeRegistry not deployed on this network')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 2: Registry Read
// ─────────────────────────────────────────────────────────────────────────────

await flow(2, 'Registry Read', async () => {
  // 2a. On-chain getServices
  if (REGISTRY) {
    try {
      const [svcs, total] = await pub.readContract({
        address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getServices', args: [0n, 20n]
      })
      ok(`Registry.getServices → ${svcs.length} service(s) (total=${total})`)
      for (const s of svcs.slice(0, 3))
        log(`   • ${s.name} | ${s.pricePerRequest} USDC | ${s.endpoint}`)
    } catch(e) { fail('Registry.getServices on-chain', e) }
  } else {
    skip('Registry.getServices — ChainPeRegistry not deployed')
  }

  if (!INDEXER) { skip('Indexer /services + /stats — INDEXER_URL not set'); return }

  // 2b. Indexer /services API
  try {
    const svcs = await get(`${INDEXER}/services`)
    ok(`Indexer /services → ${svcs.length} service(s)`)
    for (const s of svcs.slice(0, 3))
      log(`   • ${s.name} | rep=${s.reputation ? s.reputation.score : 'unrated'}`)
  } catch(e) { fail('Indexer /services', e) }

  // 2c. Indexer /stats
  try {
    const stats = await get(`${INDEXER}/stats`)
    ok(`Indexer /stats → services=${stats.services}, feedback=${stats.feedback}, network=${stats.network}`)
  } catch(e) { fail('Indexer /stats', e) }
})

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 3: x402 Payment (real 402 → pay → 200, settled by the facilitator)
// ─────────────────────────────────────────────────────────────────────────────

await flow(3, `x402 Payment (real settlement on ${NET.name})`, async () => {
  const PORT = 4404
  let server

  try {
    // 3a. Start a local x402 v2-gated test server
    const app = express()
    app.get('/health', (_req, res) => res.json({ ok: true }))
    const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR }))
      .register(NET.caip2, new ExactEvmScheme())
    app.use(
      paymentMiddleware(
        { '/*': { accepts: { scheme: 'exact', price: '$0.001', network: NET.caip2,
                             payTo: account.address },   // pay our own wallet
                  description: 'ChainPe e2e test payment' } },
        resourceServer,
        { appName: 'chainpe-e2e', testnet: NET.testnet }
      )
    )
    app.get('/data', (_req, res) => res.json({ result: 'paid content', ts: Date.now() }))

    server = await new Promise((resolve) => {
      const s = app.listen(PORT, () => resolve(s))
    })
    ok(`Local x402 test server started on :${PORT}`)

    // 3b. Verify /health is free (no 402)
    const healthRes = await fetch(`http://localhost:${PORT}/health`)
    healthRes.ok ? ok('GET /health → 200 (free, no payment required)') : fail('health endpoint not 200')

    // 3c. First call to /data should return 402 with a v2 PAYMENT-REQUIRED header
    const firstRes = await fetch(`http://localhost:${PORT}/data`)
    if (firstRes.status === 402 && firstRes.headers.get('payment-required')) {
      ok('GET /data (no payment) → 402 Payment Required (PAYMENT-REQUIRED header)')
    } else {
      fail(`Expected 402 with PAYMENT-REQUIRED, got ${firstRes.status}`)
    }

    // 3d. Use ChainPe SDK to auto-pay and get the real response
    const cp = new ChainPe({ privateKey: KEY, network: NETWORK, maxPerCall: '0.01' })

    log('Initiating SDK auto-pay (signs EIP-3009 authorization)…')
    const paid = await cp.pay(`http://localhost:${PORT}/data`)

    if (paid.ok) {
      ok(`cp.pay() → 200 — paid content received`)
      log(`   data: ${JSON.stringify(paid.data)}`)
    } else {
      fail(`cp.pay() returned non-OK status ${paid.status}`)
    }

    // 3e. x402 v2 settlement receipt header
    paid.headers['payment-response']
      ? ok('Response carries a v2 PAYMENT-RESPONSE header')
      : fail('PAYMENT-RESPONSE header missing on the paid response')

    if (paid.payment) {
      ok(`Payment settled on ${NET.name}`)
      log(`   amount    : ${paid.payment.amount} ${paid.payment.token}`)
      log(`   recipient : ${paid.payment.recipient}`)
      if (paid.payment.txHash) {
        log(`   explorer  : ${tx(paid.payment.txHash)}`)
        // 3f. Confirm tx is on-chain
        try {
          const receipt = await wait(paid.payment.txHash)
          receipt.status === 'success'
            ? ok(`On-chain confirmation → block #${receipt.blockNumber}, status=${receipt.status}`)
            : fail(`Settlement tx reverted (block #${receipt.blockNumber})`)
        } catch(e) { fail('Tx receipt wait timed out', e) }
      } else {
        fail('Facilitator did not report a settlement tx hash')
      }
    } else {
      fail('Payment info missing from cp.pay() result')
    }

  } finally {
    if (server) await new Promise(r => server.close(r))
    log('Local x402 test server closed')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 4: Discovery (cp.discover ranked by ERC-8004 reputation)
// ─────────────────────────────────────────────────────────────────────────────

await flow(4, 'Discovery — cp.discover() ranked list', async () => {
  const cp = new ChainPe({ privateKey: KEY, network: NETWORK })

  if (REGISTRY) {
    // 4a. Discover all services
    try {
      const all = await cp.discover()
      ok(`cp.discover() → ${all.length} service(s), ranked by ⭐`)
      for (const s of all.slice(0, 5)) {
        const rep = s.reputation ? `⭐ ${s.reputation.score} (${s.reputation.count} ratings)` : 'unrated'
        log(`   • ${s.name} | ${s.pricePerRequest} USDC | ${rep}`)
      }
    } catch(e) { fail('cp.discover()', e) }

    // 4b. Discover with tag filter
    try {
      const tagged = await cp.discover({ tags: ['e2e'] })
      ok(`cp.discover({ tags: ['e2e'] }) → ${tagged.length} match(es)`)
    } catch(e) { fail('cp.discover() tag filter', e) }
  } else {
    skip('cp.discover() — ChainPeRegistry not deployed')
  }

  // 4c. Balance check via SDK
  try {
    const bal = await cp.balance()
    ok(`cp.balance() → ${bal.usdc} USDC · ${bal.eth} ETH`)
  } catch(e) { fail('cp.balance()', e) }
})

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 5: Reputation (canonical ERC-8004 giveFeedback + read)
// ─────────────────────────────────────────────────────────────────────────────

await flow(5, 'Reputation — ERC-8004 on-chain feedback', async () => {
  // Register a fresh agent identity owned by our wallet.
  let agentId
  try {
    const regHash = await wallet.writeContract({
      address: IDENTITY, abi: IDENTITY_ABI, functionName: 'register',
      args: [`ipfs://chainpe-e2e-test/${Date.now()}`]
    })
    const receipt = await wait(regHash)
    // Parse agentId from the Registered event (topic[0] = keccak256("Registered(uint256,string,address)"))
    const REGISTERED_SIG = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
    const regEvent = receipt.logs.find(l =>
      l.address.toLowerCase() === IDENTITY.toLowerCase() && l.topics[0] === REGISTERED_SIG
    )
    agentId = regEvent ? BigInt(regEvent.topics[1]) : null
    if (!agentId) { fail('Could not parse agentId from Registered event'); return }
    ok(`Registered ERC-8004 identity #${agentId}`)
    log(`   tx: ${tx(regHash)}`)
  } catch(e) { fail('Register ERC-8004 identity', e); return }

  // 5a. Read initial state (no clients yet)
  try {
    const clients = await pub.readContract({
      address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getClients', args: [agentId]
    })
    ok(`getClients(agentId=${agentId}) → ${clients.length} client(s) initially`)
  } catch(e) { fail('getClients initial', e) }

  // 5b. ERC-8004 rejects feedback from the agent's own owner, so give it from a
  // fresh wallet acting as a separate client. Arbitrum gas is cheap: 0.0002 ETH is plenty.
  const secondKey = generatePrivateKey()
  const secondAccount = privateKeyToAccount(secondKey)

  try {
    const fundHash = await wallet.sendTransaction({
      to: secondAccount.address, value: parseEther('0.0002')
    })
    await wait(fundHash)
    ok(`Funded feedback wallet ${secondAccount.address} with 0.0002 ETH`)
  } catch(e) { fail('Fund second wallet', e); return }

  // 5c. Give feedback from second wallet
  try {
    const secondWallet = createWalletClient({
      account: secondAccount, chain: NET.chain, transport: http(rpcUrlFor(NETWORK))
    })
    const fbHash = await secondWallet.writeContract({
      address: REPUTATION, abi: REPUTATION_ABI, functionName: 'giveFeedback',
      args: [
        agentId,
        85n,                     // value = 85 (out of 100)
        0,                       // valueDecimals
        'reliability',           // tag1
        'speed',                 // tag2
        'https://chainpe-e2e-test.local',
        '',                      // feedbackURI
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ]
    })
    await wait(fbHash)
    ok(`giveFeedback(agentId=${agentId}, value=85) on-chain`)
    log(`   tx: ${tx(fbHash)}`)
  } catch(e) { fail('giveFeedback', e); return }

  // 5d. Read back the score
  try {
    const clients = await pub.readContract({
      address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getClients', args: [agentId]
    })
    if (clients.length === 0) { fail('No clients after feedback'); return }

    const [count, score, scoreDecimals] = await pub.readContract({
      address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getSummary',
      args: [agentId, clients, 'reliability', 'speed']
    })
    const scoreF = Number(score) / (10 ** Number(scoreDecimals))
    count === 1n && scoreF === 85
      ? ok(`getSummary(agentId=${agentId}) → score=${scoreF}, count=${count}`)
      : fail(`getSummary(agentId=${agentId}) → score=${scoreF}, count=${count} (expected 85, 1)`)
  } catch(e) { fail('getSummary after feedback', e) }
})

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 6: Registry Write (register → verify → deregister)
// ─────────────────────────────────────────────────────────────────────────────

await flow(6, 'Registry Write — register, index verify, deregister', async () => {
  if (!REGISTRY) { skip('Registry write — ChainPeRegistry not deployed'); return }

  const svcName = `E2E-${Date.now()}`
  let registered = false

  try {
    // 6a. Check current USDC balance
    const bal = await pub.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
    const fee = await pub.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'registrationFee' })
    log(`USDC balance: ${formatUnits(bal, 6)} · fee: ${formatUnits(fee, 6)}`)
    if (bal < fee) { fail(`Insufficient USDC: need ${formatUnits(fee,6)}, have ${formatUnits(bal,6)}`); return }

    // 6b. Approve USDC
    if (fee > 0n) {
      const approveTx = await wallet.writeContract({
        address: USDC_ADDR, abi: erc20Abi, functionName: 'approve',
        args: [REGISTRY, fee]
      })
      await wait(approveTx)
      ok(`USDC approved (${formatUnits(fee,6)} USDC) → registry`)
    }

    // 6c. Register
    const regTx = await wallet.writeContract({
      address: REGISTRY, abi: REGISTRY_ABI, functionName: 'register',
      args: [{
        name: svcName,
        description: 'ChainPe E2E test service — auto-deregistered',
        tags: 'e2e,test',
        endpoint: 'https://chainpe-e2e-test.local/weather',
        pricePerRequest: '0.001',
        paymentToken: 'USDC',
        network: NETWORK,
        payTo: account.address,
        agentId: 0n
      }]
    })
    await wait(regTx)
    registered = true
    ok(`Registered "${svcName}" on ChainPeRegistry`)
    log(`   tx: ${tx(regTx)}`)

    // 6d. Verify on-chain
    const [svcs] = await pub.readContract({
      address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getServices', args: [0n, 50n]
    })
    const found = svcs.find(s => s.name === svcName)
    found ? ok(`Service "${svcName}" confirmed on-chain`) : fail(`"${svcName}" not found on-chain after register`)

    // 6e. Wait for indexer to pick it up (indexer polls every ~15s)
    if (INDEXER) {
      log('Waiting for indexer to index the new service (up to 30s)…')
      let indexerFound = false
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 5000))
        try {
          const svcs2 = await get(`${INDEXER}/services`)
          if (svcs2.some(s => s.name === svcName)) { indexerFound = true; break }
        } catch {}
      }
      indexerFound ? ok(`"${svcName}" appears in indexer API`) : skip(`Indexer not yet indexed "${svcName}" (may lag > 30s)`)
    }

  } finally {
    // 6f. Deregister (cleanup)
    if (registered) {
      try {
        const deregTx = await wallet.writeContract({
          address: REGISTRY, abi: REGISTRY_ABI, functionName: 'deregister', args: [svcName]
        })
        await wait(deregTx)
        ok(`Deregistered "${svcName}" (cleanup)`)
        log(`   tx: ${tx(deregTx)}`)
      } catch(e) { fail('Deregister cleanup', e) }
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 7: PolicyVault (deploy → deposit → gasless spend → overspend rejection)
// ─────────────────────────────────────────────────────────────────────────────

await flow(7, 'PolicyVault — gasless spend + on-chain overspend rejection', async () => {
  const DEPOSIT_USDC  = '0.05'   // deposit 0.05 USDC
  const MAX_PER_CALL  = '0.02'   // policy cap per call
  const SPEND_AMOUNT  = '0.01'   // within cap
  const OVER_AMOUNT   = '0.03'   // over cap → chain rejects

  // 7a. Deploy a fresh PolicyVault
  let vaultAddress
  try {
    const deployHash = await wallet.deployContract({
      abi: VAULT_ABI,
      bytecode: VAULT_BYTECODE,
      args: [USDC_ADDR]         // constructor: token address
    })
    const receipt = await wait(deployHash)
    vaultAddress = receipt.contractAddress
    ok(`PolicyVault deployed at ${vaultAddress}`)
    log(`   tx: ${tx(deployHash)}`)
  } catch(e) { fail('Deploy PolicyVault', e); return }

  // 7b. Generate a fresh session key (the "agent") — never pays gas
  const sessionKey    = generatePrivateKey()
  const sessionAccount = privateKeyToAccount(sessionKey)
  const recipient     = '0xcA83Db44d0334499b3dfcE29c44AdF9Bc9EAa728'   // arbitrary payee

  // Owner and relayer are both our main wallet (fine for testing)
  const ownerVault = new PolicyVaultClient({ privateKey: KEY, network: NETWORK, vaultAddress })
  const sessionVault = new PolicyVaultClient({ privateKey: sessionKey, network: NETWORK, vaultAddress })
  // Relayer uses the same key as owner for this test (real deployments use a separate relayer)
  const relayerVault = new PolicyVaultClient({ privateKey: KEY, network: NETWORK, vaultAddress })

  // 7c. Approve + deposit USDC
  try {
    const approveTx = await wallet.writeContract({
      address: USDC_ADDR, abi: erc20Abi, functionName: 'approve',
      args: [vaultAddress, parseUnits(DEPOSIT_USDC, 6)]
    })
    await wait(approveTx)
    const depositTx = await ownerVault.deposit(DEPOSIT_USDC)
    await wait(depositTx)
    const vaultBal = await ownerVault.balanceOf(account.address)
    ok(`Deposited ${DEPOSIT_USDC} USDC into vault → balance=${vaultBal} USDC`)
  } catch(e) { fail('Vault deposit', e); return }

  // 7d. Set spending policy
  try {
    const policyTx = await ownerVault.setPolicy({
      sessionKey: sessionAccount.address,
      maxPerCall: MAX_PER_CALL,
      dailyCap: '0.04',
      totalBudget: DEPOSIT_USDC,
      expiry: Math.floor(Date.now() / 1000) + 3600
    })
    await wait(policyTx)
    ok(`Policy set: maxPerCall=${MAX_PER_CALL} USDC, session=${sessionAccount.address}`)
  } catch(e) { fail('setPolicy', e); return }

  // 7e. Within-cap gasless spend: agent SIGNS only, relayer SUBMITS
  try {
    log(`Agent signs ${SPEND_AMOUNT} USDC spend (agent never pays gas)…`)
    const auth = await sessionVault.signSpend({
      owner: account.address, to: recipient, amount: SPEND_AMOUNT
    })
    const spendTx = await relayerVault.relaySpend(auth)
    await wait(spendTx)
    ok(`Gasless spend of ${SPEND_AMOUNT} USDC succeeded — agent signed, relayer submitted`)
    log(`   tx: ${tx(spendTx)}`)
    const remaining = await ownerVault.dailyRemaining(account.address)
    log(`   daily remaining: ${remaining} USDC`)
  } catch(e) { fail(`Gasless spend ${SPEND_AMOUNT} USDC`, e); return }

  // 7f. Over-cap spend → chain REJECTS it
  try {
    log(`Agent signs ${OVER_AMOUNT} USDC spend (> ${MAX_PER_CALL} cap)…`)
    const badAuth = await sessionVault.signSpend({
      owner: account.address, to: recipient, amount: OVER_AMOUNT
    })
    await relayerVault.relaySpend(badAuth)
    fail(`Expected on-chain rejection but spend succeeded — policy not enforced!`)
  } catch(e) {
    const reason = e.shortMessage || e.details || e.message || String(e)
    ok(`Chain REJECTED the overspend: "${reason.slice(0,80)}"`)
  }

  // 7g. Revoke session → subsequent spends fail
  try {
    const revokeTx = await ownerVault.revokeSession()
    await wait(revokeTx)
    ok('Session revoked by owner')
    const afterAuth = await sessionVault.signSpend({
      owner: account.address, to: recipient, amount: SPEND_AMOUNT
    })
    await relayerVault.relaySpend(afterAuth)
    fail('Expected rejection after revoke but spend succeeded')
  } catch(e) {
    const reason = e.shortMessage || e.details || e.message || String(e)
    ok(`Chain REJECTED spend after session revoke: "${reason.slice(0,80)}"`)
  }

  // 7h. Withdraw remaining USDC (cleanup)
  try {
    const vaultBal = await ownerVault.balanceOf(account.address)
    if (parseFloat(vaultBal) > 0) {
      const withdrawTx = await ownerVault.withdraw(vaultBal)
      await wait(withdrawTx)
      ok(`Withdrew ${vaultBal} USDC from vault (cleanup)`)
    }
  } catch(e) { fail('Vault withdraw cleanup', e) }
})

// ── Final summary ─────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`)
console.log(`ChainPe E2E Results — ${NET.name}`)
console.log('═'.repeat(60))
console.log(`  ✅ Passed  : ${passed}`)
console.log(`  ❌ Failed  : ${failed}`)
console.log(`  ⏭  Skipped : ${skipped}`)
console.log('═'.repeat(60))
if (failed === 0) {
  console.log(`  All flows passed — ChainPe stack is healthy on ${NET.name}.`)
} else {
  console.log(`  ${failed} check(s) failed — see output above for details.`)
}
console.log()
process.exit(failed > 0 ? 1 : 0)
