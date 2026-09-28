/**
 * Arbitrum benchmark for ChainPe — block time, gas price and the real cost of an
 * x402 settlement.
 *
 * Read-only (default, no keys): chain id, average block time over recent blocks,
 * the live gas price, and execution-cost estimates for ChainPe operations at that
 * price (the L1 data fee is extra and varies with Ethereum blob prices).
 *
 * Measured settlement (set BENCH_PRIVATE_KEY, a wallet with ≥ 0.01 USDC and a
 * little ETH on the network): the key signs an EIP-3009 transferWithAuthorization
 * for 0.01 USDC to itself and submits it — exactly what a facilitator does — then
 * reports submit→receipt latency, gasUsed (which on Arbitrum includes the L1
 * component) and the actual fee paid.
 *
 * Run: node bench.mjs                                        # Arbitrum Sepolia, read-only
 *      CHAINPE_NETWORK=arbitrum node bench.mjs               # Arbitrum One, read-only
 *      BENCH_PRIVATE_KEY=0x… node bench.mjs                  # + one measured settlement
 *      ETH_USD=2600 node bench.mjs                           # fixed ETH price (else Coinbase spot)
 */
import {
  parseNetwork,
  publicClientFor,
  chainFor,
  rpcUrlFor,
  getToken,
  explorerTxUrl,
  normalizeKey
} from '@chainpe/sdk'
import { createWalletClient, http, formatEther, formatGwei, formatUnits, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const NETWORK = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')
const client = publicClientFor(NETWORK)
const usdc = getToken(NETWORK, 'USDC')

async function ethUsd() {
  if (process.env.ETH_USD) return { price: Number(process.env.ETH_USD), source: 'ETH_USD' }
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')
    const j = await r.json()
    return { price: Number(j.data.amount), source: 'Coinbase spot' }
  } catch {
    return { price: 2500, source: 'fallback (set ETH_USD)' }
  }
}

// Representative execution gas per ChainPe operation (typical EVM costs).
const OPS = [
  ['x402 settlement (USDC EIP-3009 transfer)', 75_000n],
  ['ERC-8004 giveFeedback (reputation)', 120_000n],
  ['Register a service (ChainPeRegistry)', 210_000n],
  ['PolicyVault gasless spend', 95_000n]
]

// Arbitrum block timestamps have 1 s resolution, so average over a wide span.
const N = 200
const [chainId, head, gasPrice, eth] = await Promise.all([
  client.getChainId(),
  client.getBlockNumber(),
  client.getGasPrice(),
  ethUsd()
])
const [newest, oldest] = await Promise.all([
  client.getBlock({ blockNumber: head }),
  client.getBlock({ blockNumber: head - BigInt(N) })
])
const avgBlockMs = (Number(newest.timestamp - oldest.timestamp) * 1000) / N
const usd = wei => Number(formatEther(wei)) * eth.price

console.log(`\nChainPe — ${NETWORK} benchmark`)
console.log('='.repeat(64))
console.log('  MEASURED (live):')
console.log(`    Chain ID:          ${chainId}`)
console.log(`    Latest block:      ${head}`)
console.log(`    Avg block time:    ~${Math.round(avgBlockMs)} ms  (last ${N} blocks)`)
console.log(`    Gas price:         ${formatGwei(gasPrice)} gwei`)
console.log(`    ETH/USD:           $${eth.price} (${eth.source})`)
console.log(`\n  EXECUTION cost at the live gas price (L1 data fee not included):`)
console.log('  ' + '-'.repeat(62))
for (const [label, gas] of OPS) {
  console.log(`    ${label.padEnd(44)} $${usd(gasPrice * gas).toFixed(5)}`)
}
console.log('  ' + '-'.repeat(62))

if (!process.env.BENCH_PRIVATE_KEY) {
  console.log('\n  Set BENCH_PRIVATE_KEY to measure a real settlement (0.01 USDC to itself).\n')
  process.exit(0)
}

// ── Measured settlement ──────────────────────────────────────────────────────
const account = privateKeyToAccount(normalizeKey(process.env.BENCH_PRIVATE_KEY))
const wallet = createWalletClient({ account, chain: chainFor(NETWORK), transport: http(rpcUrlFor(NETWORK)) })
const value = 10_000n // 0.01 USDC
const abi = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
]

const balance = await client.readContract({ address: usdc.address, abi, functionName: 'balanceOf', args: [account.address] })
if (balance < value) {
  console.error(`\n  ${account.address} holds ${formatUnits(balance, 6)} USDC; needs 0.01. Faucet: https://faucet.circle.com`)
  process.exit(1)
}

const now = BigInt(Math.floor(Date.now() / 1000))
const auth = {
  from: account.address,
  to: account.address,
  value,
  validAfter: now - 60n,
  validBefore: now + 600n,
  nonce: toHex(crypto.getRandomValues(new Uint8Array(32)))
}
const signature = await account.signTypedData({
  domain: { name: usdc.eip712Name, version: usdc.eip712Version, chainId, verifyingContract: usdc.address },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  },
  primaryType: 'TransferWithAuthorization',
  message: auth
})

console.log(`\n  MEASURED settlement (${account.address} → itself, 0.01 USDC):`)
const t0 = performance.now()
const hash = await wallet.writeContract({
  address: usdc.address,
  abi,
  functionName: 'transferWithAuthorization',
  args: [auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, signature]
})
const t1 = performance.now()
const receipt = await client.waitForTransactionReceipt({ hash })
const t2 = performance.now()
const fee = receipt.gasUsed * receipt.effectiveGasPrice

console.log(`    Tx:                ${explorerTxUrl(NETWORK, hash)}`)
console.log(`    Status:            ${receipt.status}`)
console.log(`    Submit (RPC ack):  ${Math.round(t1 - t0)} ms`)
console.log(`    Submit → receipt:  ${Math.round(t2 - t0)} ms`)
console.log(`    gasUsed:           ${receipt.gasUsed} (includes the L1 data component)`)
console.log(`    Fee paid:          ${formatEther(fee)} ETH ≈ $${usd(fee).toFixed(5)}\n`)
