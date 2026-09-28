/**
 * Steps 6.1b / 6.4 — runs the provider: a tiny weather backend behind the
 * ChainPe x402 proxy (`@chainpe/cli`'s startProxyServer, same code as
 * `chainpe start`), paying out to the provider wallet. Leave it running.
 *
 *   node e2e/testnet/provider.mjs              # settles through PayAI (default)
 *   FAILOVER=1 node e2e/testnet/provider.mjs   # 6.4: a dead facilitator first, then PayAI
 *   FACILITATOR_KEY=0x… node …/provider.mjs     # settle in-process (local fork rehearsal only)
 *
 * Doesn't touch ~/.chainpe/config.json.
 */
import { existsSync, readFileSync } from 'node:fs'
import express from 'express'
import { privateKeyToAccount } from 'viem/accounts'
import { startProxyServer } from '@chainpe/cli'
import { publicClientFor } from '@chainpe/sdk'
import { NETWORK, key, registryAddress, assertSepolia } from './lib.mjs'
import { SERVICE, PROVIDER_STATE } from './register.mjs'

await assertSepolia(publicClientFor(NETWORK))
const provider = privateKeyToAccount(key('PROVIDER_PRIVATE_KEY')).address
const state = existsSync(PROVIDER_STATE) ? JSON.parse(readFileSync(PROVIDER_STATE, 'utf8')) : {}
if (!state.agentId) console.warn('⚠ No ERC-8004 agent id yet — run register.mjs first, or reviews have nothing to rate.')

// Backend: deterministic demo data, so every paid call returns something checkable.
const backend = express()
backend.get('/weather', (req, res) => {
  const city = String(req.query.city || 'London')
  res.json({ city, tempC: 18, conditions: 'partly cloudy', source: 'chainpe-phase6-demo', at: new Date().toISOString() })
})
const backendServer = await new Promise(r => { const s = backend.listen(0, '127.0.0.1', () => r(s)) })

// 6.4: port 9 (discard) refuses connections, so the first facilitator is unreachable.
const DEAD_FACILITATOR = process.env.DEAD_FACILITATOR_URL || 'http://127.0.0.1:9'
// BACKUP_FACILITATOR_URL replaces PayAI (e.g. a local chainpe-facilitator for the fork rehearsal).
const backup = process.env.BACKUP_FACILITATOR_URL ? { kind: 'url', url: process.env.BACKUP_FACILITATOR_URL } : { kind: 'payai' }
const facilitators = process.env.FAILOVER ? [{ kind: 'url', url: DEAD_FACILITATOR }, backup] : [backup]

await startProxyServer({
  config: {
    serviceName: SERVICE.name,
    serviceDescription: SERVICE.description,
    tags: SERVICE.tags,
    targetUrl: `http://127.0.0.1:${backendServer.address().port}`,
    pricePerRequest: SERVICE.price,
    paymentToken: 'USDC',
    walletAddress: provider,
    proxyPort: SERVICE.port,
    network: NETWORK,
    registryAddress: registryAddress(),
    agentId: state.agentId,
    facilitators,
    discovery: { enabled: false },
    logLevel: 'verbose',
  },
  facilitatorKey: process.env.FACILITATOR_KEY,
})
console.log(`\nProvider ${provider} (agent #${state.agentId ?? '—'})`)
console.log(`Facilitators: ${process.env.FACILITATOR_KEY ? 'in-process' : facilitators.map(f => f.url ?? f.kind).join(' → ')}`)
console.log(`Paid endpoint: http://localhost:${SERVICE.port}/weather?city=Paris  (${SERVICE.price} USDC)`)
