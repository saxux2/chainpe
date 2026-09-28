/**
 * ChainPe Mainnet Real-USDC E2E Test — Arbitrum One
 *
 * Runs the full x402 v2 payment flow on Arbitrum One with REAL USDC:
 *   FLOW 1  Pre-flight   — network guard, balances, facilitator /supported
 *   FLOW 2  x402 payment — 0.01 USDC settled through a live facilitator
 *   FLOW 3  Registry     — register → read back → deregister (only when
 *                          CHAINPE_REGISTRY_ADDRESS is set; pays the registry fee)
 *
 * USDC is recoverable: the x402 payTo is the test wallet itself, so the 0.01 USDC
 * comes straight back. The registry fee goes to the registry's feeRecipient
 * (flow 3 prints it). Real cost: ETH gas, plus the fee if flow 3 runs and the
 * feeRecipient is not you.
 *
 * Requirements:
 *   CONFIRM_MAINNET=yes          explicit opt-in — the script refuses to run without it
 *   MAINNET_PRIVATE_KEY=0x…      wallet with ≥ 0.02 USDC (+ registry fee for flow 3)
 *                                and a little ETH on Arbitrum One
 *   FACILITATOR_URL              optional; default PayAI (keyless, supports eip155:42161)
 *   CHAINPE_REGISTRY_ADDRESS     optional; enables flow 3
 *   ARBITRUM_RPC_URL             optional private RPC
 *
 * Run:
 *   CONFIRM_MAINNET=yes MAINNET_PRIVATE_KEY=0x... node e2e/mainnet-arbitrum-usdc.mjs
 */

import { createWalletClient, http, parseUnits, formatUnits, formatEther, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import express from 'express'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import {
  ChainPe, getNetworkConfig, publicClientFor, rpcUrlFor, explorerTxUrl, normalizeKey
} from '../packages/chainpe-sdk/dist/index.js'

// ── Guards ────────────────────────────────────────────────────────────────────

if (process.env.CONFIRM_MAINNET !== 'yes') {
  console.error('Refusing to run: this test spends real USDC and ETH on Arbitrum One.')
  console.error('  CONFIRM_MAINNET=yes MAINNET_PRIVATE_KEY=0x... node e2e/mainnet-arbitrum-usdc.mjs')
  process.exit(1)
}
const RAW_KEY = process.env.MAINNET_PRIVATE_KEY
if (!RAW_KEY) {
  console.error('Set MAINNET_PRIVATE_KEY (a dedicated Arbitrum One test wallet).')
  process.exit(1)
}

const NETWORK         = 'arbitrum'
const NET             = getNetworkConfig(NETWORK)
const EXPECTED_CAIP2  = 'eip155:42161'
const EXPECTED_USDC   = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const FACILITATOR     = process.env.FACILITATOR_URL || 'https://facilitator.payai.network'
const REGISTRY_ADDR   = process.env.CHAINPE_REGISTRY_ADDRESS
const PAYMENT_AMOUNT  = parseUnits('0.01', 6)
const LOCAL_PORT      = Number(process.env.E2E_PORT || 4405)

const account = privateKeyToAccount(normalizeKey(RAW_KEY))
const pub     = publicClientFor(NETWORK)
const wallet  = createWalletClient({ account, chain: NET.chain, transport: http(rpcUrlFor(NETWORK)) })
const USDC    = NET.usdc

// ── Minimal registry ABI ──────────────────────────────────────────────────────

const SERVICE_INPUT = [
  { name: 'name', type: 'string' }, { name: 'description', type: 'string' },
  { name: 'tags', type: 'string' }, { name: 'endpoint', type: 'string' },
  { name: 'pricePerRequest', type: 'string' }, { name: 'paymentToken', type: 'string' },
  { name: 'network', type: 'string' }, { name: 'payTo', type: 'address' },
  { name: 'agentId', type: 'uint256' }
]
const REGISTRY_ABI = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable',
    inputs: [{ name: 'input', type: 'tuple', components: SERVICE_INPUT }],
    outputs: [{ name: 'serviceKey', type: 'bytes32' }] },
  { type: 'function', name: 'deregister', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }], outputs: [] },
  { type: 'function', name: 'registrationFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'feeRecipient', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'hasService', stateMutability: 'view',
    inputs: [{ name: 'developer', type: 'address' }, { name: 'name', type: 'string' }],
    outputs: [{ type: 'bool' }] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0
function log(msg)    { console.log(`  ${msg}`) }
function ok(msg)     { log(`✅ ${msg}`); passed++ }
function fail(msg, e){ log(`❌ ${msg}${e ? ': ' + (e.shortMessage || e.message || String(e)) : ''}`); failed++ }
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

async function flow(n, name, fn) {
  console.log(`\n${'─'.repeat(64)}`)
  console.log(`FLOW ${n}: ${name}`)
  console.log('─'.repeat(64))
  try { await fn() }
  catch (e) { fail(`Unhandled error in flow ${n}`, e) }
}

const wait = (hash) => pub.waitForTransactionReceipt({ hash, timeout: 120_000 })

// ── FLOW 1: Pre-flight ────────────────────────────────────────────────────────

await flow(1, 'Pre-flight — network guard, balances, facilitator', async () => {
  // 1a. We are really on Arbitrum One, with native USDC
  const chainId = await pub.getChainId()
  chainId === 42161 ? ok('RPC chain id is 42161 (Arbitrum One)') : (fail(`RPC chain id is ${chainId}, expected 42161`), process.exit(1))
  NET.caip2 === EXPECTED_CAIP2 ? ok(`x402 network is ${EXPECTED_CAIP2}`) : (fail(`SDK network is ${NET.caip2}`), process.exit(1))
  same(USDC, EXPECTED_USDC) ? ok(`USDC is native Circle USDC ${EXPECTED_USDC}`) : (fail(`SDK USDC is ${USDC}`), process.exit(1))

  // 1b. Balances
  log(`Wallet: ${account.address}`)
  const eth = await pub.getBalance({ address: account.address })
  eth > 0n ? ok(`ETH balance: ${formatEther(eth)} ETH`) : (fail('No ETH for gas'), process.exit(1))
  const usdc = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  usdc >= PAYMENT_AMOUNT * 2n
    ? ok(`USDC balance: ${formatUnits(usdc, 6)} USDC`)
    : (fail(`Need ≥ ${formatUnits(PAYMENT_AMOUNT * 2n, 6)} USDC, have ${formatUnits(usdc, 6)}`), process.exit(1))

  // 1c. Facilitator settles exact/USDC on Arbitrum One (x402 v2)
  const supported = await fetch(`${FACILITATOR}/supported`).then(r => r.json())
  const kind = supported.kinds?.find(k => k.network === EXPECTED_CAIP2 && k.scheme === 'exact' && k.x402Version === 2)
  kind ? ok(`Facilitator ${FACILITATOR} supports exact on ${EXPECTED_CAIP2} (v2)`) : (fail(`Facilitator ${FACILITATOR} lacks exact v2 on ${EXPECTED_CAIP2}`), process.exit(1))
})

// ── FLOW 2: x402 payment — real USDC on Arbitrum One ──────────────────────────

await flow(2, 'x402 Payment — 0.01 USDC settled on Arbitrum One', async () => {
  let server
  try {
    // 2a. Local x402 v2 server; payTo is our own wallet so the USDC comes back
    const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR }))
      .register(EXPECTED_CAIP2, new ExactEvmScheme())
    const app = express()
    app.get('/health', (_req, res) => res.json({ ok: true }))
    app.use(paymentMiddleware(
      { 'GET /data': { accepts: { scheme: 'exact', price: `$${formatUnits(PAYMENT_AMOUNT, 6)}`, network: EXPECTED_CAIP2, payTo: account.address } } },
      resourceServer
    ))
    app.get('/data', (_req, res) => res.json({ result: 'paid content', ts: Date.now() }))
    server = await new Promise(resolve => { const s = app.listen(LOCAL_PORT, () => resolve(s)) })
    ok(`Local x402 server on :${LOCAL_PORT}`)

    // 2b. The 402 offer is for Arbitrum One native USDC
    const first = await fetch(`http://localhost:${LOCAL_PORT}/data`)
    const header = first.headers.get('payment-required')
    if (first.status !== 402 || !header) { fail(`Expected 402 with PAYMENT-REQUIRED, got ${first.status}`); return }
    const required = decodePaymentRequiredHeader(header)
    const offer = required.accepts[0]
    required.x402Version === 2 ? ok('402 offer is x402 v2') : fail(`x402Version ${required.x402Version}`)
    offer.network === EXPECTED_CAIP2 ? ok(`offer.network === "${EXPECTED_CAIP2}"`) : fail(`offer.network is ${offer.network}`)
    same(offer.asset, EXPECTED_USDC) ? ok('offer.asset is Arbitrum One USDC') : fail(`offer.asset is ${offer.asset}`)
    BigInt(offer.amount) === PAYMENT_AMOUNT ? ok('offer.amount is 0.01 USDC') : fail(`offer.amount is ${offer.amount}`)

    // 2c. SDK pays
    const before = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
    const cp = new ChainPe({ privateKey: RAW_KEY, network: NETWORK, maxPerCall: formatUnits(PAYMENT_AMOUNT, 6) })
    log('cp.pay() — signing EIP-3009 authorization…')
    const paid = await cp.pay(`http://localhost:${LOCAL_PORT}/data`)
    if (!paid.ok) { fail(`cp.pay() returned ${paid.status}`); return }
    ok('cp.pay() → 200 — paid content received')

    // 2d. Settlement receipt header
    const receiptHeader = paid.headers['payment-response']
    if (!receiptHeader) { fail('PAYMENT-RESPONSE header missing'); return }
    const settle = decodePaymentResponseHeader(receiptHeader)
    settle.success ? ok('PAYMENT-RESPONSE success=true') : fail('PAYMENT-RESPONSE success=false')
    settle.network === EXPECTED_CAIP2 ? ok(`settled on ${EXPECTED_CAIP2}`) : fail(`settled on ${settle.network}`)
    if (!settle.transaction) { fail('No settlement tx hash'); return }
    log(`  explorer: ${explorerTxUrl(NETWORK, settle.transaction)}`)

    // 2e. On-chain: the tx succeeded and touched the USDC contract
    const receipt = await wait(settle.transaction)
    receipt.status === 'success' ? ok(`confirmed in block #${receipt.blockNumber}`) : fail('settlement tx reverted')
    receipt.logs.some(l => same(l.address, EXPECTED_USDC))
      ? ok('settlement emitted a USDC Transfer')
      : fail('no USDC log in the settlement tx')
    const after = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
    log(`  USDC before ${formatUnits(before, 6)} → after ${formatUnits(after, 6)} (payTo is this wallet)`)
  } finally {
    if (server) await new Promise(r => server.close(r))
  }
})

// ── FLOW 3: Registry write (optional) ─────────────────────────────────────────

await flow(3, 'Registry — register → read back → deregister', async () => {
  if (!REGISTRY_ADDR) { log('⏭  CHAINPE_REGISTRY_ADDRESS not set — skipped'); return }
  const svcName = `ChainPe-E2E-${Date.now()}`
  let registered = false
  try {
    const fee = await pub.readContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'registrationFee' })
    const recipient = await pub.readContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'feeRecipient' })
    log(`fee ${formatUnits(fee, 6)} USDC → feeRecipient ${recipient}${same(recipient, account.address) ? ' (you)' : ''}`)

    const approve = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [REGISTRY_ADDR, fee] })
    await wait(approve)
    ok(`approved ${formatUnits(fee, 6)} USDC`)

    const reg = await wallet.writeContract({
      address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'register',
      args: [{
        name: svcName, description: 'ChainPe mainnet E2E test service — auto-deregistered',
        tags: 'e2e,test,mainnet', endpoint: 'https://chainpe-e2e-test.invalid/api',
        pricePerRequest: '0.01', paymentToken: 'USDC', network: NETWORK,
        payTo: account.address, agentId: 0n,
      }]
    })
    await wait(reg)
    registered = true
    ok(`registered "${svcName}"  ${explorerTxUrl(NETWORK, reg)}`)

    const exists = await pub.readContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'hasService', args: [account.address, svcName] })
    exists ? ok('hasService() → true') : fail('service not found after register')
  } finally {
    if (registered) {
      try {
        const dereg = await wallet.writeContract({ address: REGISTRY_ADDR, abi: REGISTRY_ABI, functionName: 'deregister', args: [svcName] })
        await wait(dereg)
        ok(`deregistered (cleanup)  ${explorerTxUrl(NETWORK, dereg)}`)
      } catch (e) { fail('deregister cleanup', e) }
    }
  }
})

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(64)}`)
console.log('ChainPe Arbitrum One E2E — Results')
console.log('═'.repeat(64))
console.log(`  ✅ Passed : ${passed}`)
console.log(`  ❌ Failed : ${failed}`)
console.log('═'.repeat(64))
console.log(failed === 0 ? '  ALL FLOWS PASSED — real USDC settled on Arbitrum One.\n' : `  ${failed} check(s) failed — see output above.\n`)
process.exit(failed > 0 ? 1 : 0)
