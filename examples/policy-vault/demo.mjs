/**
 * PolicyVault demo — gasless, policy-bounded agent spending, and the chain
 * blocking an overspend (the winning moment).
 *
 * Roles (three distinct keys):
 *   OWNER   funds the vault + sets the policy        (pays gas for setup)
 *   SESSION the agent's scoped signer — only SIGNS   (no gas, no tx)
 *   RELAYER submits the signed spend                 (pays gas)
 *
 * Run: node demo.mjs   (needs POLICY_VAULT_ADDRESS + the three funded keys;
 *      defaults to Arbitrum Sepolia, set CHAINPE_NETWORK=arbitrum for mainnet)
 */
import 'dotenv/config'
import {
  PolicyVaultClient,
  publicClientFor,
  parseNetwork,
  chainFor,
  rpcUrlFor,
  getUsdcAddress,
  explorerTxUrl
} from '@chainpe/sdk'
import { createWalletClient, http, parseUnits, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

function need(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing env ${name}. See .env.example.`)
    process.exit(1)
  }
  return v
}

// Chain constants come from the SDK's network table; unknown names throw.
const NETWORK = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')
const CHAIN = chainFor(NETWORK)
const RPC = rpcUrlFor(NETWORK)
const USDC = getUsdcAddress(NETWORK)

const VAULT = need('POLICY_VAULT_ADDRESS')
const ownerKey = need('OWNER_KEY')
const sessionKey = need('SESSION_KEY')
const relayerKey = need('RELAYER_KEY')
const recipient = need('RECIPIENT')

const owner = new PolicyVaultClient({ privateKey: ownerKey, network: NETWORK, vaultAddress: VAULT })
const session = new PolicyVaultClient({ privateKey: sessionKey, network: NETWORK, vaultAddress: VAULT })
const relayer = new PolicyVaultClient({ privateKey: relayerKey, network: NETWORK, vaultAddress: VAULT })

const pub = publicClientFor(NETWORK)
const wait = (hash) => pub.waitForTransactionReceipt({ hash })
const reason = (e) => e?.shortMessage || e?.details || e?.message || String(e)

console.log('network:', NETWORK)
console.log('owner  :', owner.getAddress())
console.log('session:', session.getAddress(), '(agent — signs, pays no gas)')
console.log('relayer:', relayer.getAddress(), '(submits, pays gas)')

// 0. Owner approves + deposits 5 USDC into the vault.
const ownerAccount = privateKeyToAccount(ownerKey.startsWith('0x') ? ownerKey : `0x${ownerKey}`)
const ownerWallet = createWalletClient({ account: ownerAccount, chain: CHAIN, transport: http(RPC) })
console.log('\n[setup] approving + depositing 5 USDC…')
await wait(
  await ownerWallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [VAULT, parseUnits('5', 6)]
  })
)
await wait(await owner.deposit('5'))

// 1. Owner sets the policy: ≤1 USDC/call, ≤2/day, ≤5 total, valid 1h.
console.log('[setup] setting policy: maxPerCall=1, dailyCap=2, totalBudget=5 USDC…')
await wait(
  await owner.setPolicy({
    sessionKey: session.getAddress(),
    maxPerCall: '1',
    dailyCap: '2',
    totalBudget: '5',
    expiry: Math.floor(Date.now() / 1000) + 3600
  })
)
console.log('  vault balance:', await owner.balanceOf(owner.getAddress()), 'USDC')

// 2. Within policy → succeeds (agent signs, relayer pays gas).
console.log('\n[1] agent signs a 0.5 USDC spend; relayer submits…')
const ok = await session.signSpend({ owner: owner.getAddress(), to: recipient, amount: '0.5' })
const tx1 = await relayer.relaySpend(ok)
await wait(tx1)
console.log('  ✓ paid 0.5 USDC gaslessly:', explorerTxUrl(NETWORK, tx1))
console.log('  daily remaining:', await owner.dailyRemaining(owner.getAddress()), 'USDC')

// 3. Over the per-call cap → the chain REJECTS it.
console.log('\n[2] agent signs a 2 USDC spend (> 1 cap); relayer submits…')
try {
  const bad = await session.signSpend({ owner: owner.getAddress(), to: recipient, amount: '2' })
  await wait(await relayer.relaySpend(bad))
  console.log('  ✗ UNEXPECTED: the spend was not rejected.')
} catch (e) {
  console.log('  ✓ chain rejected the overspend:', reason(e))
}

// 4. Owner revokes the session → further spends fail.
console.log('\n[3] owner revokes the session; agent signs another 0.5 spend…')
await wait(await owner.revokeSession())
try {
  const after = await session.signSpend({ owner: owner.getAddress(), to: recipient, amount: '0.5' })
  await wait(await relayer.relaySpend(after))
  console.log('  ✗ UNEXPECTED: spend succeeded after revoke.')
} catch (e) {
  console.log('  ✓ chain rejected after revoke:', reason(e))
}

console.log('\nDone. Policy enforced on-chain; agent never paid gas.')
