/**
 * Local end-to-end test — the whole ChainPe payment flow without testnet funds.
 *
 *   Hardhat node (chain id 421614, so it looks like Arbitrum Sepolia)
 *     └─ MockUSDC placed at the canonical Arbitrum Sepolia USDC address
 *     └─ ChainPeRegistry deployed with that USDC as fee token
 *   Provider: @chainpe/cli proxy + in-process facilitator in front of a tiny backend
 *   Payer:    @chainpe/sdk — discovers the service in the registry and pays it
 *
 * The SDK, CLI proxy and x402 v2 packages run unmodified; only the RPC URL points
 * at the local node. Hardhat's well-known dev keys are used, on the local chain only.
 *
 * Run:  node --test e2e/local.test.mjs     (after `npm run build` and `npx hardhat compile`)
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import {
  createPublicClient, createWalletClient, createTestClient, http,
  parseUnits, formatUnits, toHex, stringToHex, erc20Abi
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia } from 'viem/chains'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACTS = resolve(ROOT, 'contracts')
const PORT = Number(process.env.E2E_HARDHAT_PORT || 18545)
const RPC = `http://127.0.0.1:${PORT}`

// Point every ChainPe package at the local node before loading them.
process.env.ARBITRUM_SEPOLIA_RPC_URL = RPC
delete process.env.CHAINPE_INDEXER_URL
delete process.env.CHAINPE_REGISTRY_ADDRESS

const { ChainPe, NETWORKS } = await import('@chainpe/sdk')
const { startProxyServer, ChainPeRegistryClient } = await import('@chainpe/cli')

const NETWORK = 'arbitrum-sepolia'
const USDC = NETWORKS[NETWORK].usdc

// Hardhat's default dev accounts (public keys — local chain only).
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // deployer
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // payer
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // provider
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // facilitator gas key
]
const [deployer, payer, provider, facilitator] = KEYS.map(k => privateKeyToAccount(k))

const chain = { ...arbitrumSepolia, rpcUrls: { default: { http: [RPC] } } }
const pub = createPublicClient({ chain, transport: http(RPC) })
const testClient = createTestClient({ chain, mode: 'hardhat', transport: http(RPC) })
const walletOf = account => createWalletClient({ account, chain, transport: http(RPC) })

const artifact = name =>
  JSON.parse(readFileSync(resolve(CONTRACTS, `artifacts/contracts/${name}.sol/${name.split('/').pop()}.json`), 'utf8'))

let node
let backendServer
let proxyServer
let registryAddress
let proxyUrl

async function waitForNode() {
  for (let i = 0; i < 120; i++) {
    try {
      const id = await pub.getChainId()
      if (id === 421614) return
      throw new Error(`Hardhat node has chain id ${id}, expected 421614`)
    } catch (e) {
      if (String(e.message).includes('expected 421614')) throw e
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error('Hardhat node did not start')
}

function stopNode() {
  if (!node || node.exitCode !== null) return
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${node.pid} /T /F`, { stdio: 'ignore' }) } catch {}
  } else {
    try { process.kill(-node.pid, 'SIGTERM') } catch {}
  }
}

/** ERC-20 short-string storage encoding (≤ 31 bytes): left-aligned bytes, last byte = len * 2. */
function shortString(s) {
  const hex = stringToHex(s).slice(2).padEnd(62, '0')
  return `0x${hex}${toHex(s.length * 2, { size: 1 }).slice(2)}`
}

async function deploy(name, args, account = deployer) {
  const { abi, bytecode } = artifact(name)
  const hash = await walletOf(account).deployContract({ abi, bytecode, args })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  return receipt.contractAddress
}

before(async () => {
  node = spawn('npx', ['hardhat', 'node', '--port', String(PORT)], {
    cwd: CONTRACTS,
    env: { ...process.env, HARDHAT_CHAIN_ID: '421614', MAINNET_FORK: 'false' },
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  })
  await waitForNode()

  // 1. MockUSDC at the canonical Arbitrum Sepolia USDC address.
  const { abi: usdcAbi } = artifact('mocks/MockUSDC')
  const mock = await deploy('mocks/MockUSDC', [])
  await testClient.setCode({ address: USDC, bytecode: await pub.getCode({ address: mock }) })
  // Constructor storage doesn't move with setCode: restore ERC20 name/symbol (slots 3, 4).
  await testClient.setStorageAt({ address: USDC, index: 3, value: shortString('USD Coin') })
  await testClient.setStorageAt({ address: USDC, index: 4, value: shortString('USDC') })
  assert.equal(await pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'name' }), 'USD Coin')

  const mint = async (to, amount) =>
    pub.waitForTransactionReceipt({
      hash: await walletOf(deployer).writeContract({ address: USDC, abi: usdcAbi, functionName: 'mint', args: [to, parseUnits(amount, 6)] })
    })
  await mint(payer.address, '10')
  await mint(provider.address, '5')

  // 2. ChainPeRegistry: 1 USDC fee, no identity registry.
  registryAddress = await deploy('ChainPeRegistry', [USDC, deployer.address, parseUnits('1', 6), '0x0000000000000000000000000000000000000000', deployer.address])

  // 3. Provider backend + ChainPe x402 proxy with an in-process facilitator.
  const backend = express()
  backend.get('/data', (_req, res) => res.json({ result: 'paid content' }))
  backendServer = await new Promise(r => { const s = backend.listen(0, () => r(s)) })

  const proxyPort = 18600 + Math.floor(Math.random() * 300)
  const started = await startProxyServer({
    config: {
      serviceName: 'Local E2E Service',
      serviceDescription: 'Local end-to-end test service',
      tags: ['e2e', 'local'],
      targetUrl: `http://127.0.0.1:${backendServer.address().port}`,
      pricePerRequest: '0.01',
      paymentToken: 'USDC',
      walletAddress: provider.address,
      proxyPort,
      network: NETWORK,
      discovery: { enabled: false },
      logLevel: 'quiet',
    },
    facilitatorKey: KEYS[3],
  })
  proxyServer = started.server
  proxyUrl = `http://127.0.0.1:${proxyPort}`
})

after(async () => {
  await Promise.all([proxyServer, backendServer].filter(Boolean).map(s => new Promise(r => s.close(r))))
  stopNode()
})

test('unpaid request gets an x402 v2 offer for canonical USDC', async () => {
  const res = await fetch(`${proxyUrl}/data`)
  assert.equal(res.status, 402)
  const header = res.headers.get('payment-required')
  assert.ok(header, 'PAYMENT-REQUIRED header present')
  const offer = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  assert.equal(offer.x402Version, 2)
  assert.equal(offer.accepts[0].network, 'eip155:421614')
  assert.equal(offer.accepts[0].asset.toLowerCase(), USDC.toLowerCase())
  assert.equal(offer.accepts[0].amount, '10000')
  assert.equal(offer.accepts[0].payTo.toLowerCase(), provider.address.toLowerCase())
})

test('SDK pays the 402 and the facilitator settles on-chain', async () => {
  const balance = a => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] })
  const [payerBefore, providerBefore] = await Promise.all([balance(payer.address), balance(provider.address)])

  const cp = new ChainPe({ privateKey: KEYS[1], network: NETWORK, maxPerCall: '0.05' })
  const paid = await cp.pay(`${proxyUrl}/data`)

  assert.equal(paid.status, 200)
  assert.deepEqual(paid.data, { result: 'paid content' })
  assert.ok(paid.headers['payment-response'], 'PAYMENT-RESPONSE header present')
  assert.equal(paid.payment?.amount, '0.01')
  assert.equal(paid.payment?.token, 'USDC')
  assert.ok(paid.payment?.txHash, 'settlement tx hash reported')

  const receipt = await pub.getTransactionReceipt({ hash: paid.payment.txHash })
  assert.equal(receipt.status, 'success')
  assert.equal(receipt.from.toLowerCase(), facilitator.address.toLowerCase(), 'facilitator paid the gas')

  const [payerAfter, providerAfter] = await Promise.all([balance(payer.address), balance(provider.address)])
  assert.equal(formatUnits(payerBefore - payerAfter, 6), '0.01')
  assert.equal(formatUnits(providerAfter - providerBefore, 6), '0.01')
})

test('SDK refuses to pay above maxPerCall', async () => {
  const cp = new ChainPe({ privateKey: KEYS[1], network: NETWORK, maxPerCall: '0.001' })
  await assert.rejects(cp.pay(`${proxyUrl}/data`), /exceeds maxPerCall/)
})

test('a registered service is discoverable from the SDK', async () => {
  const client = new ChainPeRegistryClient(NETWORK, registryAddress)
  await client.registerService({
    privateKey: KEYS[2],
    name: 'Local E2E Service',
    description: 'Local end-to-end test service',
    tags: ['e2e', 'local'],
    endpoint: proxyUrl,
    pricePerRequest: '0.01',
    paymentToken: 'USDC',
    walletAddress: provider.address,
    network: NETWORK,
    agentId: '0',
    isUpdate: false,
  })

  const cp = new ChainPe({ privateKey: KEYS[1], network: NETWORK, registryAddress })
  const services = await cp.discover({ query: 'e2e', sources: ['registry'] })
  const found = services.find(s => s.endpoint === proxyUrl)
  assert.ok(found, 'service found via cp.discover()')
  assert.equal(found.source, 'registry')
  assert.equal(found.walletAddress.toLowerCase(), provider.address.toLowerCase())

  // And it can be paid straight from the discovery result.
  const paid = await cp.pay(`${found.endpoint}/data`)
  assert.equal(paid.status, 200)
})
