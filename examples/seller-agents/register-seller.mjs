/**
 * Register a seller agent's service on the ChainPe on-chain registry
 * (non-interactive). Auto-mints an ERC-8004 identity on the canonical Identity
 * Registry if SELLER_AGENT_ID is not set and the wallet doesn't already have one.
 *
 * Run (env-driven):
 *   SELLER_KEY=0x... SELLER_PAYTO=0x... SELLER_NAME="Research Agent" \
 *   SELLER_ENDPOINT=http://host:4501 SELLER_TAGS=ai,research SELLER_PRICE=0.01 \
 *   node register-seller.mjs
 *
 * Needs CHAINPE_REGISTRY_ADDRESS, the registry fee in USDC and a little ETH on the seller wallet.
 */
import 'dotenv/config'
import { parseNetwork, explorerTxUrl } from '@chainpe/sdk'
import {
  ChainPeRegistryClient,
  mintAgentIdentity,
  hasIdentity,
  resolveIdentityRegistry,
} from '@chainpe/cli'

const network = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')
const registryAddress = process.env.CHAINPE_REGISTRY_ADDRESS

function need(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env ${name}.`)
    process.exit(1)
  }
  return v
}

const privateKey = need('SELLER_KEY')
const sellerName = need('SELLER_NAME')
const endpoint = need('SELLER_ENDPOINT')
const walletAddress = need('SELLER_PAYTO')
need('CHAINPE_REGISTRY_ADDRESS')

// ── ERC-8004 identity ────────────────────────────────────────────────────────
let agentId = process.env.SELLER_AGENT_ID || '0'
const identityRegistry = resolveIdentityRegistry(network)

if (agentId === '0' && identityRegistry) {
  if (await hasIdentity({ network, identityRegistry, ownerAddress: walletAddress })) {
    console.log(`ℹ  ${sellerName}: wallet already has an ERC-8004 identity.`)
    console.log(`   Set SELLER_AGENT_ID=<n> to link it, or it will register with agentId=0.`)
  } else {
    console.log(`Minting ERC-8004 identity for "${sellerName}"…`)
    try {
      const minted = await mintAgentIdentity({ network, privateKey, identityRegistry })
      agentId = minted.agentId
      console.log(`✓ ERC-8004 identity minted: agent #${agentId}  (${explorerTxUrl(network, minted.txHash)})`)
    } catch (err) {
      console.warn(`  ⚠ Identity mint failed (${err?.message || err}). Registering with agentId=0.`)
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const client = new ChainPeRegistryClient(network, registryAddress)
const isUpdate = await client.hasService(walletAddress, sellerName).catch(() => false)

console.log(`${isUpdate ? 'Updating' : 'Registering'} "${sellerName}" → ${endpoint} on ${network}…`)
try {
  const result = await client.registerService({
    privateKey,
    name: sellerName,
    description: process.env.SELLER_DESCRIPTION || `${sellerName} — paid x402 service`,
    tags: (process.env.SELLER_TAGS || 'ai,agent').split(',').map((t) => t.trim()).filter(Boolean),
    endpoint,
    pricePerRequest: process.env.SELLER_PRICE || '0.01',
    paymentToken: 'USDC',
    walletAddress,
    network,
    agentId,
    isUpdate,
  })
  console.log(`✓ ${isUpdate ? 'updated' : 'registered'}  agentId=${agentId}  ${explorerTxUrl(network, result.txnHash)}`)
} catch (err) {
  console.error(`✗ ${err?.message || err}`)
  process.exit(1)
}
