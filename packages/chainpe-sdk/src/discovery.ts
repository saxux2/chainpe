/**
 * Merged service discovery across three sources:
 *   1. ChainPeRegistry (when an address is configured)
 *   2. Coinbase's x402 Bazaar
 *   3. ERC-8004 registration files of the agents found above (plus any
 *      `agentIds` passed in)
 *
 * Results are de-duplicated by endpoint URL — earlier sources win, so
 * registry data is preferred — then annotated with ERC-8004 reputation and
 * ranked. A source that fails is skipped; discovery only throws when every
 * source it tried failed.
 */
import { resolveRegistryAddress } from './networks.js'
import { RegistryClient, filterServices, rankByReputation } from './registry.js'
import { searchBazaar } from './bazaar.js'
import { discoverFromIdentity } from './identity.js'
import { getReputation } from './reputation.js'
import type {
  ChainPeNetwork,
  ChainPeService,
  DiscoverOptions,
  RankedService,
  ServiceSource
} from './types.js'

export interface DiscoveryContext {
  /** ChainPeRegistry address. Without one, the registry source is skipped. */
  registryAddress?: `0x${string}`
  /** ERC-8004 Reputation Registry, for scores. */
  reputationRegistry?: `0x${string}`
  /** ChainPe indexer, for payment-verified scores (defaults to `CHAINPE_INDEXER_URL`). */
  indexerUrl?: string
  /** ERC-8004 Identity Registry. Without one, the erc8004 source is skipped. */
  identityRegistry?: `0x${string}`
  /** Bazaar discovery base URL (defaults to CDP). */
  bazaarUrl?: string
}

const ALL_SOURCES: ServiceSource[] = ['registry', 'bazaar', 'erc8004']

/** Registration files read per discovery, so a large registry can't fan out unbounded. */
const MAX_IDENTITY_LOOKUPS = 25

/** Endpoint key for de-duplication: lower-case origin, no trailing slash. Pure. */
export function endpointKey(endpoint: string): string {
  try {
    const u = new URL(endpoint)
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.host}${path}${u.search}`.toLowerCase()
  } catch {
    return endpoint.trim().replace(/\/+$/, '').toLowerCase()
  }
}

/** Keeps the first service per endpoint. Pure. */
export function dedupeByEndpoint<T extends ChainPeService>(services: T[]): T[] {
  const seen = new Set<string>()
  return services.filter(s => {
    const key = endpointKey(s.endpoint)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Discovers services on `network` from every configured source. */
export async function discoverServices(
  network: ChainPeNetwork,
  options: DiscoverOptions = {},
  ctx: DiscoveryContext = {}
): Promise<RankedService[]> {
  const sources = options.sources ?? ALL_SOURCES
  const errors: unknown[] = []
  let attempted = 0

  const run = async (fn: () => Promise<RankedService[]>): Promise<RankedService[]> => {
    attempted++
    try {
      return await fn()
    } catch (err) {
      errors.push(err)
      return []
    }
  }

  const useRegistry = sources.includes('registry')
  if (useRegistry && !ctx.registryAddress && sources.length === 1) {
    // Only the registry was asked for: a missing address is an error.
    resolveRegistryAddress(network)
  }

  const [fromRegistry, fromBazaar] = await Promise.all([
    useRegistry && ctx.registryAddress
      ? run(async () => {
          const all = await new RegistryClient(network, ctx.registryAddress!).listAllServices()
          return filterServices(all, options).map(s => ({ ...s, reputation: null }))
        })
      : Promise.resolve([]),
    sources.includes('bazaar')
      ? run(() =>
          searchBazaar({
            network,
            query: options.query,
            maxPrice: options.maxPrice,
            tags: options.tags,
            url: ctx.bazaarUrl
          })
        )
      : Promise.resolve([])
  ])

  let fromIdentity: RankedService[] = []
  if (sources.includes('erc8004') && ctx.identityRegistry) {
    const agentIds = [
      ...(options.agentIds ?? []),
      ...[...fromRegistry, ...fromBazaar].map(s => s.agentId).filter((id): id is string => !!id)
    ]
    const unique = [...new Set(agentIds)].slice(0, MAX_IDENTITY_LOOKUPS)
    if (unique.length > 0) {
      const known = new Set([...fromRegistry, ...fromBazaar].map(s => endpointKey(s.endpoint)))
      fromIdentity = await run(async () =>
        filterServices(
          await discoverFromIdentity(network, ctx.identityRegistry!, unique, e =>
            known.has(endpointKey(e))
          ),
          options
        ) as RankedService[]
      )
    }
  }

  if (attempted > 0 && errors.length === attempted) throw errors[0]

  const merged = dedupeByEndpoint([...fromRegistry, ...fromBazaar, ...fromIdentity])
  const scored = await Promise.all(
    merged.map(async s => ({
      ...s,
      reputation: s.agentId
        ? await getReputation(network, ctx.reputationRegistry, s.agentId, {
            indexerUrl: ctx.indexerUrl
          })
        : null
    }))
  )
  return rankByReputation(scored)
}
