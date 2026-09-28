/**
 * Shared helpers for the Phase 6 Arbitrum Sepolia validation scripts.
 *
 * Keys come from the gitignored root `.env` (payer, provider, session) and
 * `contracts/.env` (deployer). Scripts refuse to run on any chain but 421614.
 * Every transaction worth recording is appended to `e2e/testnet/.phase6/log.jsonl`
 * (gitignored); `node e2e/testnet/status.mjs --log` prints it for docs/DEPLOYMENTS.md.
 */
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// PHASE6_DIR moves the state + log elsewhere (used for a local fork rehearsal).
export const LOG_DIR = resolve(process.env.PHASE6_DIR || resolve(ROOT, 'e2e/testnet/.phase6'))
export const LOG_FILE = resolve(LOG_DIR, 'log.jsonl')

/** Loads KEY=value lines into process.env without overwriting what is already set. */
function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && m[2] !== '' && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, 'contracts/.env'))

export const NETWORK = 'arbitrum-sepolia'
export const CHAIN_ID = 421614

export function key(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing ${name} (root .env or contracts/.env).`)
  return v.startsWith('0x') ? v : `0x${v}`
}

/** Deployment records written by contracts/scripts/deploy*.ts. */
export function deployment(kind = 'registry') {
  const file = resolve(ROOT, `contracts/deployments/arbitrumSepolia${kind === 'vault' ? '-policyvault' : ''}.json`)
  if (!existsSync(file)) return undefined
  const d = JSON.parse(readFileSync(file, 'utf8'))
  if (d.chainId !== CHAIN_ID) throw new Error(`${file} is for chain ${d.chainId}, not ${CHAIN_ID}.`)
  return d
}

export function registryAddress() {
  const addr = process.env.CHAINPE_REGISTRY_ADDRESS || deployment('registry')?.chainPeRegistryProxy
  if (!addr) throw new Error('No ChainPeRegistry on Arbitrum Sepolia yet — run `npm run deploy:sepolia` in contracts/.')
  // The SDK / CLI resolve the registry from env.
  process.env.CHAINPE_REGISTRY_ADDRESS = addr
  return addr
}

/** Aborts unless the RPC really is Arbitrum Sepolia. */
export async function assertSepolia(publicClient) {
  const id = await publicClient.getChainId()
  if (id !== CHAIN_ID) throw new Error(`RPC is chain ${id}, expected Arbitrum Sepolia (${CHAIN_ID}).`)
}

/** Appends one validation record, e.g. { step: '6.2', what: 'SDK paid call', tx }. */
export function record(entry) {
  mkdirSync(LOG_DIR, { recursive: true })
  const row = { at: new Date().toISOString(), ...entry }
  appendFileSync(LOG_FILE, JSON.stringify(row) + '\n')
  return row
}

export const arbiscanTx = hash => `https://sepolia.arbiscan.io/tx/${hash}`
