/**
 * Generate the demo wallets and print a ready-to-paste .env block.
 *
 * Run once: node gen-wallets.mjs
 * Then paste the output into .env and fund the wallets per the instructions.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const roles = [
  { name: 'Buyer (orchestrator)' },
  { name: 'Research Seller' },
  { name: 'News Digest Seller' },
  { name: 'Arbitrum Price Agent' },
  { name: 'Arbitrum News Agent' },
  { name: 'Arbitrum Analysis Agent' },
  { name: 'Arbitrum DEX Agent' },
]

const [buyer, research, digest, price, news, analysis, dex] = roles.map((r) => {
  const privateKey = generatePrivateKey()
  const { address } = privateKeyToAccount(privateKey)
  return { ...r, privateKey, address }
})
const sellers = [research, digest, price, news, analysis, dex]

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  ChainPe demo wallets — SAVE THESE PRIVATELY')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

for (const w of [buyer, ...sellers]) {
  console.log(`${w.name}`)
  console.log(`  Address:     ${w.address}`)
  console.log(`  Private key: ${w.privateKey}`)
  console.log()
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Fund on Arbitrum Sepolia BEFORE continuing:')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
console.log('USDC — https://faucet.circle.com  (select "Arbitrum Sepolia")')
console.log(`  ${buyer.address}  ← Buyer (~2 USDC for agent fees)`)
console.log()
console.log('Sellers only need funds to REGISTER on-chain (registry fee in USDC + a little ETH).')
console.log('Easiest: also fund the buyer with Sepolia ETH, then run `node fund-sellers.mjs`,')
console.log('which sends each seller the registry fee + gas from the buyer wallet.')
console.log('Payments themselves need no ETH — the facilitator (PayAI) pays settlement gas.')
console.log()

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Paste this block into .env:')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const envBlock = `
# ─── Buyer (orchestrator / investment fund manager) ──────────────────────
CHAINPE_PRIVATE_KEY=${buyer.privateKey}

# ─── Original demo sellers ────────────────────────────────────────────────
RESEARCH_PAYTO=${research.address}
RESEARCH_PAYTO_KEY=${research.privateKey}
DIGEST_PAYTO=${digest.address}
DIGEST_PAYTO_KEY=${digest.privateKey}

# ─── Investment agents ────────────────────────────────────────────────────
PRICE_PAYTO=${price.address}
PRICE_PAYTO_KEY=${price.privateKey}
NEWS_PAYTO=${news.address}
NEWS_PAYTO_KEY=${news.privateKey}
ANALYSIS_PAYTO=${analysis.address}
ANALYSIS_PAYTO_KEY=${analysis.privateKey}
DEX_PAYTO=${dex.address}
DEX_PAYTO_KEY=${dex.privateKey}

# ─── LLM ─────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ─── Network + contracts ──────────────────────────────────────────────────
CHAINPE_NETWORK=arbitrum-sepolia
CHAINPE_REGISTRY_ADDRESS=0x...   # see docs/DEPLOYMENTS.md

# ─── Portfolio seed (paper trading) ───────────────────────────────────────
PORTFOLIO_USDC=5.0
PORTFOLIO_ETH=0
`.trim()

console.log(envBlock)

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  After funding, launch + register all agents:')
console.log('  INVEST_AGENTS=1 REGISTER=1 ./launch.sh')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  Claude Desktop wallet (chainpe-wallet-mcp) config —')
console.log('  Settings → Developer → Edit Config → add under "mcpServers":')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

const mcpConfig = {
  'chainpe-wallet': {
    command: 'node',
    args: ['/absolute/path/to/packages/chainpe-wallet/dist/index.js'],
    env: {
      CHAINPE_PRIVATE_KEY: buyer.privateKey,
      NETWORK: 'arbitrum-sepolia',
      CHAINPE_REGISTRY_ADDRESS: '0x...',
      MAX_PER_CALL: '0.05',
      MAX_PER_DAY: '1.00',
    },
  },
}

console.log(JSON.stringify({ mcpServers: mcpConfig }, null, 2))
console.log()
