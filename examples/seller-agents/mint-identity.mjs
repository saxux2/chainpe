/**
 * Mint an ERC-8004 agent identity (canonical Identity Registry) and print its agentId.
 *
 * Each seller agent gets a distinct identity so it can accrue portable on-chain
 * reputation. Spends a little ETH for gas on the seller's wallet.
 *
 * Run: node mint-identity.mjs <privateKey> [agentURI]
 *  or: SELLER_KEY=0x... node mint-identity.mjs
 */
import 'dotenv/config'
import { parseNetwork, explorerTxUrl } from '@chainpe/sdk'
import { mintAgentIdentity, resolveIdentityRegistry } from '@chainpe/cli'

const network = parseNetwork(process.env.CHAINPE_NETWORK, 'arbitrum-sepolia')

const key = process.argv[2] || process.env.SELLER_KEY || process.env.PRIVATE_KEY
if (!key) {
  console.error('Usage: node mint-identity.mjs <privateKey> [agentURI]   (or set SELLER_KEY)')
  process.exit(1)
}
const agentURI = process.argv[3] || 'chainpe://seller-agent'

console.log(`Minting ERC-8004 identity on ${network}…`)
const { agentId, txHash } = await mintAgentIdentity({
  network,
  privateKey: key,
  identityRegistry: resolveIdentityRegistry(network),
  agentURI,
})
console.log(`✓ agentId ${agentId}  (${explorerTxUrl(network, txHash)})`)
// Print just the id on the last line for easy capture in scripts.
console.log(agentId)
