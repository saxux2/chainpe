/**
 * Fund all seller wallets from a single master wallet so they can register.
 *
 * Sends each seller wallet:
 *   - ETH_PER_SELLER (default 0.0005 ETH) — gas for the ERC-8004 identity mint + register
 *   - the registry's registrationFee in USDC (read on-chain) + 0.05 USDC buffer
 *
 * Payments to sellers need none of this — the facilitator pays settlement gas.
 *
 * Run:
 *   MASTER_KEY=0x... node fund-sellers.mjs
 *   # Or with the buyer key already in .env:
 *   node fund-sellers.mjs
 */
import 'dotenv/config'
import { createWalletClient, http, parseEther, parseUnits, formatUnits, formatEther, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  parseNetwork,
  publicClientFor,
  chainFor,
  rpcUrlFor,
  getUsdcAddress,
  resolveRegistryAddress,
  normalizeKey,
  NETWORKS,
} from '@chainpe/sdk'

const NETWORK = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')
const USDC = getUsdcAddress(NETWORK)
const REGISTRY = resolveRegistryAddress(NETWORK) // throws without CHAINPE_REGISTRY_ADDRESS
const ETH_PER_SELLER = parseEther(process.env.ETH_PER_SELLER || '0.0005')

const rawKey = process.env.MASTER_KEY || process.env.CHAINPE_PRIVATE_KEY
if (!rawKey) {
  console.error(`Set MASTER_KEY=0x... (a ${NETWORK} wallet with USDC and a little ETH)`)
  process.exit(1)
}
const masterAccount = privateKeyToAccount(normalizeKey(rawKey))

const pub = publicClientFor(NETWORK)
const wallet = createWalletClient({ account: masterAccount, chain: chainFor(NETWORK), transport: http(rpcUrlFor(NETWORK)) })

const registrationFee = await pub.readContract({
  address: REGISTRY,
  abi: [{ type: 'function', name: 'registrationFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  functionName: 'registrationFee',
})
const USDC_PER_SELLER = registrationFee + parseUnits('0.05', 6)

const SELLERS = [
  { label: 'Research Agent', addr: process.env.RESEARCH_PAYTO },
  { label: 'Digest Agent',   addr: process.env.DIGEST_PAYTO },
  { label: 'Price Agent',    addr: process.env.PRICE_PAYTO },
  { label: 'News Agent',     addr: process.env.NEWS_PAYTO },
  { label: 'Analysis Agent', addr: process.env.ANALYSIS_PAYTO },
  { label: 'DEX Agent',      addr: process.env.DEX_PAYTO },
].filter((s) => s.addr)

if (!SELLERS.length) {
  console.error('No seller addresses found in .env. Run gen-wallets.mjs first.')
  process.exit(1)
}

const ethWei = await pub.getBalance({ address: masterAccount.address })
const usdcRaw = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [masterAccount.address] })
const needEth = ETH_PER_SELLER * BigInt(SELLERS.length)
const needUsdc = USDC_PER_SELLER * BigInt(SELLERS.length)

console.log(`\nNetwork: ${NETWORK}  ·  registry ${REGISTRY}  ·  fee ${formatUnits(registrationFee, 6)} USDC`)
console.log(`Master wallet: ${masterAccount.address}`)
console.log(`  ETH:  ${formatEther(ethWei)}  (need ≥${formatEther(needEth)} + gas)`)
console.log(`  USDC: ${formatUnits(usdcRaw, 6)}  (need ≥${formatUnits(needUsdc, 6)})`)

if (ethWei <= needEth) {
  console.error(`\n✗ Not enough ETH on ${NETWORK}.`)
  process.exit(1)
}
if (usdcRaw < needUsdc) {
  const hint = NETWORKS[NETWORK].faucetUrl ? `\n  ${NETWORKS[NETWORK].faucetUrl}  (select Arbitrum Sepolia)` : ''
  console.error(`\n✗ Not enough USDC. Get ${formatUnits(needUsdc - usdcRaw, 6)} more.${hint}`)
  process.exit(1)
}

console.log(`\nFunding ${SELLERS.length} seller wallets...\n`)

for (const { label, addr } of SELLERS) {
  process.stdout.write(`  ${label.padEnd(18)} ${addr}`)

  const ethTx = await wallet.sendTransaction({ to: addr, value: ETH_PER_SELLER })
  await pub.waitForTransactionReceipt({ hash: ethTx, timeout: 60_000 })

  const usdcTx = await wallet.writeContract({
    address: USDC, abi: erc20Abi, functionName: 'transfer',
    args: [addr, USDC_PER_SELLER],
  })
  await pub.waitForTransactionReceipt({ hash: usdcTx, timeout: 60_000 })

  console.log(`  ✓  +${formatEther(ETH_PER_SELLER)} ETH  +${formatUnits(USDC_PER_SELLER, 6)} USDC`)
}

console.log('\nAll sellers funded. Run register-all.mjs to register on-chain.')
