/**
 * Steps 6.2 / 6.3 — one paid call to the Phase 6 service from a ChainPe payer,
 * followed by ERC-8004 feedback carrying the payment proof. provider.mjs must
 * be running. The wallet MCP is tested by hand in Claude Desktop (see README).
 *
 *   node e2e/testnet/pay.mjs sdk      # @chainpe/sdk  ChainPe.pay({ autoFeedback })
 *   node e2e/testnet/pay.mjs agent    # @chainpe/agent  discovery + callPaidApi tool (no LLM)
 *   STEP=6.4 node e2e/testnet/pay.mjs sdk   # label the record (failover run)
 */
import { existsSync, readFileSync } from 'node:fs'
import { erc20Abi, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainPe, NETWORKS, publicClientFor } from '@chainpe/sdk'
import { NETWORK, key, registryAddress, assertSepolia, record, arbiscanTx } from './lib.mjs'
import { SERVICE, PROVIDER_STATE } from './register.mjs'

const mode = process.argv[2]
if (!['sdk', 'agent'].includes(mode)) {
  console.error('Usage: node e2e/testnet/pay.mjs <sdk|agent>')
  process.exit(1)
}
const step = process.env.STEP || '6.2'
const pub = publicClientFor(NETWORK)
await assertSepolia(pub)
const privateKey = key('CHAINPE_PRIVATE_KEY')
const payer = privateKeyToAccount(privateKey).address
const provider = privateKeyToAccount(key('PROVIDER_PRIVATE_KEY')).address
registryAddress()
const state = existsSync(PROVIDER_STATE) ? JSON.parse(readFileSync(PROVIDER_STATE, 'utf8')) : {}
const url = `${state.endpoint || `http://localhost:${SERVICE.port}`}/weather?city=Paris`

let paymentTx, feedbackTx, data
if (mode === 'sdk') {
  const cp = new ChainPe({ privateKey, network: NETWORK, maxPerCall: '0.05', autoFeedback: true })
  const res = await cp.pay(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
  data = res.data
  paymentTx = res.payment?.txHash
  feedbackTx = res.reputation?.txHash
} else {
  const { PaymentClient, ServiceDiscovery, createCallPaidApiTool } = await import('@chainpe/agent')
  const discovery = new ServiceDiscovery({ network: NETWORK })
  const found = await discovery.search({ query: 'weather' })
  const svc = found.find(s => s.name === SERVICE.name)
  if (!svc) throw new Error(`Agent discovery did not find "${SERVICE.name}" (found: ${found.map(s => s.name).join(', ') || 'nothing'})`)
  console.log(`agent discovered "${svc.name}" at ${svc.endpoint} (agent #${svc.agentId})`)
  const tool = createCallPaidApiTool({
    // The tool's result omits the settlement hash; the payment client reports it.
    paymentClient: new PaymentClient({ privateKey, network: NETWORK, maxPerPayment: '0.05', onPayment: r => { paymentTx = r.txId } }),
    discovery,
    privateKey,
    network: NETWORK,
  })
  const res = await tool.execute({ serviceName: SERVICE.name, path: '/weather?city=Paris', method: 'GET' }, { toolCallId: 'phase6', messages: [] })
  if (!res.success) throw new Error(`callPaidApi failed: ${JSON.stringify(res)}`)
  data = res.data
  feedbackTx = res.reputation?.txHash
}

console.log('response:', JSON.stringify(data))
if (!paymentTx) throw new Error('No settlement tx hash reported — was the call actually paid?')

// Check the USDC Transfer payer → provider in the settlement receipt.
const receipt = await pub.getTransactionReceipt({ hash: paymentTx })
const transfer = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).find(
  l => l.address.toLowerCase() === NETWORKS[NETWORK].usdc.toLowerCase() &&
    l.args.from.toLowerCase() === payer.toLowerCase() && l.args.to.toLowerCase() === provider.toLowerCase()
)
if (receipt.status !== 'success' || !transfer) throw new Error(`Settlement ${paymentTx} has no USDC transfer payer → provider`)
console.log(`✓ paid ${Number(transfer.args.value) / 1e6} USDC payer → provider (gas paid by ${receipt.from})  ${arbiscanTx(paymentTx)}`)
record({ step, what: `${mode} paid call (${Number(transfer.args.value) / 1e6} USDC, settled by ${receipt.from})`, tx: paymentTx })

if (feedbackTx) {
  console.log(`✓ feedback with proof of payment  ${arbiscanTx(feedbackTx)}`)
  record({ step: '6.3', what: `${mode} ERC-8004 feedback for agent #${state.agentId}`, tx: feedbackTx })
} else {
  console.log('✗ no feedback was posted (agent id missing, or the tx failed — the SDK swallows the error)')
  process.exitCode = 1
}
