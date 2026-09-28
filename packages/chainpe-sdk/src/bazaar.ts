/**
 * Coinbase x402 Bazaar search.
 *
 * CDP lists x402 resources after their first paid settlement through CDP.
 * Listing and search are public: no API key needed. Results are filtered to
 * the SDK's network, the `exact` scheme and known stablecoins, and mapped to
 * {@link RankedService} with `source: 'bazaar'`.
 */
import { HTTPFacilitatorClient } from '@x402/core/server'
import { withBazaar, type DiscoveryResource } from '@x402/extensions/bazaar'
import { getX402Network } from './networks.js'
import { filterServices } from './registry.js'
import { serviceFromOffers } from './offers.js'
import type { ChainPeNetwork, RankedService } from './types.js'

/** CDP's x402 API; discovery lives under `/discovery/{resources,search}`. */
export const CDP_BAZAAR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402'

/** Largest `limit` CDP's search endpoint accepts. */
export const MAX_SEARCH_LIMIT = 20

export interface SearchBazaarOptions {
  network: ChainPeNetwork
  /** Natural-language query. Without one (and without tags), nothing is returned. */
  query?: string
  /** Max price per request (human units). */
  maxPrice?: string
  /** Used as the query when there is none. */
  tags?: string[]
  /** Max results to request. Default and maximum: 20. */
  limit?: number
  /** Discovery base URL. Default {@link CDP_BAZAAR_URL}. */
  url?: string
}

/** Maps one Bazaar resource to a service, or undefined when it isn't payable on `network`. Pure. */
export function bazaarResourceToService(
  resource: DiscoveryResource,
  network: ChainPeNetwork
): RankedService | undefined {
  return serviceFromOffers(
    resource.accepts ?? [],
    {
      endpoint: resource.resource,
      name: resource.serviceName,
      description: resource.description,
      tags: resource.tags,
      updatedAt: resource.lastUpdated
    },
    network,
    'bazaar'
  )
}

/**
 * Searches Coinbase's x402 Bazaar for services payable on `network`.
 *
 * Only CDP's search endpoint filters by network — its list endpoint ignores
 * the filter and returns mostly Base resources — so a query is required. The
 * tags stand in when there is no query; with neither, nothing is returned.
 */
export async function searchBazaar(options: SearchBazaarOptions): Promise<RankedService[]> {
  const query = options.query?.trim() || options.tags?.join(' ').trim()
  if (!query) return []

  const client = withBazaar(new HTTPFacilitatorClient({ url: options.url ?? CDP_BAZAAR_URL }))
  const { resources } = await client.extensions.bazaar.search({
    query,
    network: getX402Network(options.network),
    scheme: 'exact',
    type: 'http',
    // CDP rejects a limit above 20 with HTTP 400.
    limit: Math.min(options.limit ?? MAX_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
  })

  const seen = new Set<string>()
  const services: RankedService[] = []
  for (const r of resources ?? []) {
    const s = bazaarResourceToService(r, options.network)
    if (!s || seen.has(s.endpoint)) continue
    seen.add(s.endpoint)
    services.push(s)
  }
  // The query already ran server-side (semantic search); only apply hard
  // filters. Tags filter only when they weren't the query themselves.
  return filterServices(services, {
    maxPrice: options.maxPrice,
    tags: options.query?.trim() ? options.tags : undefined
  }) as RankedService[]
}
