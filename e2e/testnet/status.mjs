/**
 * Phase 6 readiness: balances of the four test wallets, deployed contracts, and
 * what is still missing before each step can run.
 *
 *   node e2e/testnet/status.mjs          # balances + checklist
 *   node e2e/testnet/status.mjs --log    # also print recorded validation txs
 */
import { existsSync, readFileSync } from 'node:fs'
import { formatEther, formatUnits, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { NETWORKS, publicClientFor } from '@chainpe/sdk'
import { NETWORK, key, deployment, assertSepolia, LOG_FILE, arbiscanTx } from './lib.mjs'

const pub = publicClientFor(NETWORK)
await assertSepolia(pub)
const USDC = NETWORKS[NETWORK].usdc

const wallets = {
  deployer: 'DEPLOYER_PRIVATE_KEY',
  payer: 'CHAINPE_PRIVATE_KEY',
  provider: 'PROVIDER_PRIVATE_KEY',
  session: 'SESSION_PRIVATE_KEY',
}
// Rough needs for the whole of Phase 6 (gas is ~0.01–0.1 gwei on Arbitrum Sepolia).
const NEEDS = {
  deployer: { eth: 0.005, usdc: 0 },
  payer: { eth: 0.002, usdc: 3 },
  provider: { eth: 0.002, usdc: 1 },
  session: { eth: 0, usdc: 0 },
}

const bal = {}
console.log(`Arbitrum Sepolia — block ${await pub.getBlockNumber()}\n`)
for (const [role, envName] of Object.entries(wallets)) {
  const address = privateKeyToAccount(key(envName)).address
  const [eth, usdc] = await Promise.all([
    pub.getBalance({ address }),
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ])
  bal[role] = { eth: Number(formatEther(eth)), usdc: Number(formatUnits(usdc, 6)) }
  const ok = bal[role].eth >= NEEDS[role].eth && bal[role].usdc >= NEEDS[role].usdc
  console.log(
    `${ok ? '✓' : '✗'} ${role.padEnd(8)} ${address}  ${bal[role].eth.toFixed(5)} ETH  ${bal[role].usdc.toFixed(2)} USDC` +
      (ok ? '' : `   (needs ≥ ${NEEDS[role].eth} ETH, ≥ ${NEEDS[role].usdc} USDC)`)
  )
}

const reg = deployment('registry')
const vault = deployment('vault')
console.log(`\nChainPeRegistry: ${reg ? `${reg.chainPeRegistryProxy} (block ${reg.deployBlock})` : '— not deployed'}`)
console.log(`PolicyVault:     ${vault ? `${vault.policyVaultProxy} (block ${vault.deployBlock})` : '— not deployed'}`)
console.log(`Etherscan key:   ${process.env.ETHERSCAN_API_KEY ? 'set' : '— not set (verification skipped)'}`)

if (process.argv.includes('--log')) {
  console.log('\nRecorded validation transactions:')
  if (!existsSync(LOG_FILE)) console.log('  (none yet)')
  else
    for (const line of readFileSync(LOG_FILE, 'utf8').trim().split('\n')) {
      const r = JSON.parse(line)
      console.log(`  ${r.step.padEnd(4)} ${r.what}${r.tx ? `  ${arbiscanTx(r.tx)}` : ''}${r.note ? `  (${r.note})` : ''}`)
    }
}
