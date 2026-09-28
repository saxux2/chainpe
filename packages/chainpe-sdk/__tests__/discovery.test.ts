import { describe, it, expect, vi, afterEach } from 'vitest'
import { encodePaymentRequiredHeader } from '@x402/core/http'
import type { PaymentRequirements } from '@x402/core/types'
import type { DiscoveryResource } from '@x402/extensions/bazaar'
import { bazaarResourceToService, searchBazaar, CDP_BAZAAR_URL } from '../src/bazaar.js'
import { discoverServices, dedupeByEndpoint, endpointKey } from '../src/discovery.js'
import { x402Endpoints, loadRegistrationFile, probeOffers } from '../src/identity.js'
import { RegistryClient } from '../src/registry.js'
import type { ChainPeService } from '../src/types.js'

const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const SEPOLIA_USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
const PAY_TO = '0x1111111111111111111111111111111111111111'
const REGISTRY = '0x2222222222222222222222222222222222222222'

function offer(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'eip155:42161',
    asset: ARB_USDC,
    amount: '10000',
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {},
    ...over
  }
}

function resource(url: string, accepts: PaymentRequirements[], over: Partial<DiscoveryResource> = {}): DiscoveryResource {
  return {
    resource: url,
    type: 'http',
    x402Version: 2,
    accepts,
    lastUpdated: '2026-09-01T00:00:00Z',
    serviceName: 'Weather',
    description: 'Weather data',
    tags: ['weather'],
    ...over
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('bazaarResourceToService', () => {
  it('maps an Arbitrum USDC offer and tags it as bazaar', () => {
    const s = bazaarResourceToService(
      resource('https://api.example.com/weather', [offer({ extra: { agentId: '7' } })]),
      'arbitrum'
    )
    expect(s).toMatchObject({
      source: 'bazaar',
      endpoint: 'https://api.example.com/weather',
      name: 'Weather',
      pricePerRequest: '0.01',
      paymentToken: 'USDC',
      walletAddress: PAY_TO,
      network: 'arbitrum',
      agentId: '7'
    })
  })

  it('skips offers on other networks, other schemes and unknown tokens', () => {
    const r = resource('https://x.example', [
      offer({ network: 'eip155:8453' }),
      offer({ scheme: 'upto' }),
      offer({ asset: '0x3333333333333333333333333333333333333333' })
    ])
    expect(bazaarResourceToService(r, 'arbitrum')).toBeUndefined()
  })
})

describe('searchBazaar', () => {
  it('queries CDP with the network filter and keeps only Arbitrum results', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({
        x402Version: 2,
        resources: [
          resource('https://a.example/weather', [offer()]),
          resource('https://b.example/base-only', [offer({ network: 'eip155:8453' })]),
          resource('https://c.example/pricey', [offer({ amount: '5000000' })])
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const results = await searchBazaar({ network: 'arbitrum', query: 'weather', maxPrice: '1' })

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(`${CDP_BAZAAR_URL}/discovery/search`)
    expect(url.searchParams.get('network')).toBe('eip155:42161')
    expect(url.searchParams.get('query')).toBe('weather')
    expect(results.map(r => r.endpoint)).toEqual(['https://a.example/weather'])
    expect(results[0].source).toBe('bazaar')
  })

  it('caps the limit at 20 (CDP rejects more with HTTP 400)', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ x402Version: 2, resources: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await searchBazaar({ network: 'arbitrum', query: 'x', limit: 100 })
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('limit')).toBe('20')
  })

  it('searches by tags without a query, and skips the call with neither', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ x402Version: 2, resources: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchBazaar({ network: 'arbitrum' })).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    await searchBazaar({ network: 'arbitrum', tags: ['weather', 'data'] })
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('query')).toBe('weather data')
  })
})

describe('dedupeByEndpoint', () => {
  it('treats case and trailing slashes as the same endpoint and keeps the first', () => {
    expect(endpointKey('https://API.example.com/weather/')).toBe(endpointKey('https://api.example.com/weather'))
    const a = { endpoint: 'https://api.example.com/x', source: 'registry' } as ChainPeService
    const b = { endpoint: 'https://API.example.com/x/', source: 'bazaar' } as ChainPeService
    expect(dedupeByEndpoint([a, b])).toEqual([a])
  })
})

describe('discoverServices', () => {
  const registryService: ChainPeService = {
    id: `${PAY_TO}:Weather`,
    name: 'Weather (registry)',
    description: 'Registered weather API',
    tags: ['weather'],
    endpoint: 'https://a.example/weather',
    pricePerRequest: '0.01',
    paymentToken: 'USDC',
    walletAddress: PAY_TO,
    network: 'arbitrum',
    developer: PAY_TO,
    source: 'registry'
  }

  it('merges registry and Bazaar results, preferring registry data for the same endpoint', async () => {
    vi.spyOn(RegistryClient.prototype, 'listAllServices').mockResolvedValue([registryService])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          x402Version: 2,
          resources: [
            resource('https://a.example/weather/', [offer()], { serviceName: 'Weather (bazaar)' }),
            resource('https://d.example/forecast', [offer()])
          ]
        })
      )
    )

    const results = await discoverServices(
      'arbitrum',
      { query: 'weather' },
      { registryAddress: REGISTRY }
    )

    expect(results).toHaveLength(2)
    const a = results.find(r => endpointKey(r.endpoint) === endpointKey('https://a.example/weather'))!
    expect(a.source).toBe('registry')
    expect(a.name).toBe('Weather (registry)')
    expect(results.find(r => r.endpoint === 'https://d.example/forecast')?.source).toBe('bazaar')
  })

  it('works without a registry address (Bazaar only)', async () => {
    const listSpy = vi.spyOn(RegistryClient.prototype, 'listAllServices')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ x402Version: 2, resources: [resource('https://d.example/f', [offer()])] }))
    )
    const results = await discoverServices('arbitrum', { query: 'f' })
    expect(listSpy).not.toHaveBeenCalled()
    expect(results.map(r => r.source)).toEqual(['bazaar'])
  })

  it('returns registry results when the Bazaar is down', async () => {
    vi.spyOn(RegistryClient.prototype, 'listAllServices').mockResolvedValue([registryService])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const results = await discoverServices('arbitrum', { query: 'weather' }, { registryAddress: REGISTRY })
    expect(results.map(r => r.source)).toEqual(['registry'])
  })

  it('throws when every source it tried failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    await expect(discoverServices('arbitrum', { query: 'weather' })).rejects.toThrow(/503/)
  })
})

describe('ERC-8004 registration files', () => {
  it('lists HTTP endpoints only for active, x402-capable agents', () => {
    const services = [
      { name: 'web', endpoint: 'https://a.example/api' },
      { name: 'A2A', endpoint: 'https://a.example/.well-known/agent.json' },
      { name: 'ENS', endpoint: 'agent.eth' }
    ]
    expect(x402Endpoints({ x402Support: true, services })).toEqual([
      'https://a.example/api',
      'https://a.example/.well-known/agent.json'
    ])
    expect(x402Endpoints({ x402Support: false, services })).toEqual([])
    expect(x402Endpoints({ x402Support: true, active: false, services })).toEqual([])
  })

  it('reads base64 data: URIs without a network call', async () => {
    const file = { name: 'Agent', x402Support: true }
    const uri = `data:application/json;base64,${btoa(JSON.stringify(file))}`
    await expect(loadRegistrationFile(uri)).resolves.toEqual(file)
  })

  it('rewrites ipfs:// to the gateway and refuses plain http', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ name: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    await loadRegistrationFile('ipfs://bafyabc')
    expect(fetchMock.mock.calls[0][0]).toBe('https://ipfs.io/ipfs/bafyabc')
    await expect(loadRegistrationFile('http://insecure.example/a.json')).resolves.toBeUndefined()
  })

  it('reads 402 offers from the PAYMENT-REQUIRED header', async () => {
    const accepts = [offer({ network: 'eip155:421614', asset: SEPOLIA_USDC })]
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', {
            status: 402,
            headers: {
              'PAYMENT-REQUIRED': encodePaymentRequiredHeader({
                x402Version: 2,
                resource: { url: 'https://a.example/api' },
                accepts
              })
            }
          })
      )
    )
    await expect(probeOffers('https://a.example/api')).resolves.toEqual(accepts)
  })
})
