/**
 * Tops up the payer and provider with Arbitrum Sepolia ETH from the deployer,
 * so only the deployer has to be funded from a faucet.
 *
 *   node e2e/testnet/fund.mjs            # top each up to 0.002 ETH
 *   TOPUP_ETH=0.003 node e2e/testnet/fund.mjs
 */
import { createWalletClient, http, parseEther, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainFor, rpcUrlFor, publicClientFor } from '@chainpe/sdk'
import { NETWORK, key, assertSepolia, record, arbiscanTx } from './lib.mjs'

const pub = publicClientFor(NETWORK)
await assertSepolia(pub)
const target = parseEther(process.env.TOPUP_ETH || '0.002')
const deployer = privateKeyToAccount(key('DEPLOYER_PRIVATE_KEY'))
const wallet = createWalletClient({ account: deployer, chain: chainFor(NETWORK), transport: http(rpcUrlFor(NETWORK)) })

for (const [role, envName] of [['payer', 'CHAINPE_PRIVATE_KEY'], ['provider', 'PROVIDER_PRIVATE_KEY']]) {
  const to = privateKeyToAccount(key(envName)).address
  const have = await pub.getBalance({ address: to })
  if (have >= target) {
    console.log(`✓ ${role} already has ${formatEther(have)} ETH`)
    continue
  }
  const hash = await wallet.sendTransaction({ to, value: target - have })
  await pub.waitForTransactionReceipt({ hash })
  record({ step: '6.0', what: `ETH top-up deployer → ${role} (${formatEther(target - have)} ETH)`, tx: hash })
  console.log(`✓ sent ${formatEther(target - have)} ETH to ${role}  ${arbiscanTx(hash)}`)
}
console.log(`deployer left: ${formatEther(await pub.getBalance({ address: deployer.address }))} ETH`)
