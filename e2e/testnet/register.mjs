/**
 * Step 6.1a — mints an ERC-8004 identity for the provider (once) and registers
 * the Phase 6 demo service on the ChainPeRegistry, paying the USDC fee.
 *
 *   node e2e/testnet/register.mjs
 *   PROVIDER_ENDPOINT=https://my-tunnel.example node e2e/testnet/register.mjs
 *
 * The endpoint defaults to the local proxy that provider.mjs starts, which is
 * enough for payers on this machine (SDK, agent, Claude Desktop).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainPeRegistryClient, mintAgentIdentity, resolveIdentityRegistry } from '@chainpe/cli'
import { publicClientFor } from '@chainpe/sdk'
import { NETWORK, LOG_DIR, key, registryAddress, assertSepolia, record, arbiscanTx } from './lib.mjs'

export const SERVICE = {
  name: 'ChainPe Phase6 Weather',
  description: 'Arbitrum Sepolia validation service: current weather for a city (demo data).',
  tags: ['weather', 'phase6', 'testnet'],
  price: '0.01',
  port: Number(process.env.PROVIDER_PORT || 4021),
}
export const PROVIDER_STATE = resolve(LOG_DIR, 'provider.json')

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await assertSepolia(publicClientFor(NETWORK))
  const privateKey = key('PROVIDER_PRIVATE_KEY')
  const provider = privateKeyToAccount(privateKey).address
  const registry = registryAddress()
  const endpoint = process.env.PROVIDER_ENDPOINT || `http://localhost:${SERVICE.port}`
  const state = existsSync(PROVIDER_STATE) ? JSON.parse(readFileSync(PROVIDER_STATE, 'utf8')) : {}

  // 1. ERC-8004 identity, minted once and kept in the state file.
  if (!state.agentId) {
    const minted = await mintAgentIdentity({
      network: NETWORK,
      privateKey,
      identityRegistry: resolveIdentityRegistry(NETWORK),
    })
    state.agentId = minted.agentId
    // Saved now so a failed registration below doesn't mint a second identity.
    mkdirSync(LOG_DIR, { recursive: true })
    writeFileSync(PROVIDER_STATE, JSON.stringify(state, null, 2) + '\n')
    record({ step: '6.1', what: `ERC-8004 identity minted for provider (agent #${minted.agentId})`, tx: minted.txHash })
    console.log(`✓ ERC-8004 agent #${minted.agentId}  ${arbiscanTx(minted.txHash)}`)
  } else {
    console.log(`ℹ provider already has ERC-8004 agent #${state.agentId}`)
  }

  // 2. Register (or update) the service.
  const client = new ChainPeRegistryClient(NETWORK, registry)
  const isUpdate = await client.hasService(provider, SERVICE.name)
  const result = await client.registerService({
    privateKey,
    name: SERVICE.name,
    description: SERVICE.description,
    tags: SERVICE.tags,
    endpoint,
    pricePerRequest: SERVICE.price,
    paymentToken: 'USDC',
    walletAddress: provider,
    network: NETWORK,
    agentId: state.agentId,
    isUpdate,
  })
  record({ step: '6.1', what: `Service "${SERVICE.name}" ${isUpdate ? 'updated' : 'registered'} → ${endpoint}`, tx: result.txnHash })
  console.log(`✓ ${isUpdate ? 'updated' : 'registered'} "${SERVICE.name}"  ${arbiscanTx(result.txnHash)}`)

  writeFileSync(PROVIDER_STATE, JSON.stringify({ ...state, endpoint, registry, provider }, null, 2) + '\n')
}
