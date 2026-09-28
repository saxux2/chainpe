/**
 * Step 6.5 — PolicyVault on Arbitrum Sepolia: deposit, set a session policy,
 * spend through the relayer, and hit the daily cap on purpose.
 *
 *   node e2e/testnet/vault.mjs
 *
 * Roles: payer = vault owner (deposits, sets policy), session key = agent
 * (only signs), deployer = relayer (pays gas). Spends go to the provider.
 * Deposits 2 USDC; 1 USDC is spent, the rest is withdrawn at the end.
 */
import { createWalletClient, http, parseUnits, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PolicyVaultClient, NETWORKS, chainFor, rpcUrlFor, publicClientFor } from '@chainpe/sdk'
import { NETWORK, key, deployment, assertSepolia, record, arbiscanTx } from './lib.mjs'

const pub = publicClientFor(NETWORK)
await assertSepolia(pub)
const vaultAddress = process.env.POLICY_VAULT_ADDRESS || deployment('vault')?.policyVaultProxy
if (!vaultAddress) throw new Error('No PolicyVault on Arbitrum Sepolia yet — run `npm run deploy:policyvault:sepolia` in contracts/.')

const ownerKey = key('CHAINPE_PRIVATE_KEY')
const vaultFor = privateKey => new PolicyVaultClient({ privateKey, network: NETWORK, vaultAddress })
const owner = vaultFor(ownerKey)
const session = vaultFor(key('SESSION_PRIVATE_KEY'))
const relayer = vaultFor(key('DEPLOYER_PRIVATE_KEY'))
const ownerAddr = owner.getAddress()
const recipient = privateKeyToAccount(key('PROVIDER_PRIVATE_KEY')).address
const wait = async (hash, what) => {
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${what} reverted: ${arbiscanTx(hash)}`)
  record({ step: '6.5', what, tx: hash })
  console.log(`✓ ${what}  ${arbiscanTx(hash)}`)
}
const reason = e => e?.cause?.data?.errorName || e?.shortMessage || e?.message || String(e)

console.log(`vault ${vaultAddress}\nowner ${ownerAddr}  session ${session.getAddress()}  relayer ${relayer.getAddress()}\n`)

// 1. Deposit 2 USDC.
const ownerWallet = createWalletClient({ account: privateKeyToAccount(ownerKey), chain: chainFor(NETWORK), transport: http(rpcUrlFor(NETWORK)) })
await wait(
  await ownerWallet.writeContract({ address: NETWORKS[NETWORK].usdc, abi: erc20Abi, functionName: 'approve', args: [vaultAddress, parseUnits('2', 6)] }),
  'approve 2 USDC to the vault'
)
await wait(await owner.deposit('2'), 'deposit 2 USDC')

// 2. Policy: ≤0.5 per call, ≤1 per day, ≤2 total, valid for 1 hour of chain time.
const now = Number((await pub.getBlock()).timestamp)
await wait(
  await owner.setPolicy({ sessionKey: session.getAddress(), maxPerCall: '0.5', dailyCap: '1', totalBudget: '2', expiry: now + 3600 }),
  'setPolicy maxPerCall=0.5 dailyCap=1 totalBudget=2'
)

// 3. Two spends within the policy: the session key signs, the relayer pays gas.
for (const n of [1, 2]) {
  const auth = await session.signSpend({ owner: ownerAddr, to: recipient, amount: '0.5' })
  await wait(await relayer.relaySpend(auth), `relayed spend #${n}: 0.5 USDC → provider`)
}
console.log(`  daily remaining: ${await owner.dailyRemaining(ownerAddr)} USDC`)

// 4. A third 0.5 spend exceeds the 1 USDC daily cap and must be rejected by the contract.
try {
  const auth = await session.signSpend({ owner: ownerAddr, to: recipient, amount: '0.5' })
  const hash = await relayer.relaySpend(auth)
  await pub.waitForTransactionReceipt({ hash })
  throw new Error(`UNEXPECTED: over-cap spend was accepted (${arbiscanTx(hash)})`)
} catch (e) {
  if (String(e.message).startsWith('UNEXPECTED')) throw e
  const why = reason(e)
  if (!/OverDailyCap|daily/i.test(why)) throw new Error(`Over-cap spend failed for another reason: ${why}`)
  record({ step: '6.5', what: 'third 0.5 USDC spend rejected by the contract', note: why.split('\n')[0] })
  console.log(`✓ daily cap enforced: ${why.split('\n')[0]}`)
}

// 5. Withdraw what is left.
const left = await owner.balanceOf(ownerAddr)
if (Number(left) > 0) await wait(await owner.withdraw(left), `withdraw ${left} USDC`)
