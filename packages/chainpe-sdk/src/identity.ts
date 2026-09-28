/**
 * ERC-8004 Identity Registry as a discovery source.
 *
 * An agent's `tokenURI` points to its registration file (ipfs://, https:// or
 * data:). When the file declares `x402Support` and lists HTTP services, each
 * endpoint is probed once without payment to read its 402 offer (price, token,
 * payTo). Only known agent ids are read — the registry is never scanned.
 */
import type { PaymentRequirements } from '@x402/core/types'
import { decodePaymentRequiredHeader } from '@x402/core/http'
import { publicClientFor } from './networks.js'
import { serviceFromOffers } from './offers.js'
import type { ChainPeNetwork, RankedService } from './types.js'

const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }]
  }
] as const

/** Public gateway used to read `ipfs://` registration files. */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

const FETCH_TIMEOUT_MS = 5_000
/** Endpoints probed per agent, so one registration file can't fan out unbounded. */
const MAX_ENDPOINTS_PER_AGENT = 5

/** The fields ChainPe reads from an ERC-8004 registration file. */
export interface RegistrationFile {
  name?: string
  description?: string
  services?: Array<{ name?: string; endpoint?: string }>
  x402Support?: boolean
  active?: boolean
}

/** HTTP(S) endpoints of an x402-capable, active agent. Pure. */
export function x402Endpoints(file: RegistrationFile): string[] {
  if (file.x402Support !== true || file.active === false) return []
  const urls = (file.services ?? [])
    .map(s => s.endpoint)
    .filter((e): e is string => typeof e === 'string' && /^https?:\/\//i.test(e))
  return [...new Set(urls)].slice(0, MAX_ENDPOINTS_PER_AGENT)
}

/** Reads a registration file from an agent URI. Returns undefined for unsupported schemes. */
export async function loadRegistrationFile(uri: string): Promise<RegistrationFile | undefined> {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',')
    if (comma < 0) return undefined
    const meta = uri.slice(5, comma)
    const payload = uri.slice(comma + 1)
    const text = meta.endsWith(';base64')
      ? new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0)))
      : decodeURIComponent(payload)
    return JSON.parse(text) as RegistrationFile
  }
  const url = uri.startsWith('ipfs://') ? IPFS_GATEWAY + uri.slice('ipfs://'.length) : uri
  if (!/^https:\/\//i.test(url)) return undefined
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`registration file ${url}: HTTP ${res.status}`)
  return (await res.json()) as RegistrationFile
}

/** Reads the 402 offers of an endpoint by calling it once without payment. */
export async function probeOffers(endpoint: string): Promise<PaymentRequirements[]> {
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (res.status !== 402) return []
  const header = res.headers.get('PAYMENT-REQUIRED')
  if (header) {
    try {
      return decodePaymentRequiredHeader(header).accepts ?? []
    } catch {
      /* fall through to the body */
    }
  }
  const body = (await res.json().catch(() => undefined)) as { accepts?: PaymentRequirements[] } | undefined
  return Array.isArray(body?.accepts) ? body.accepts : []
}

/**
 * Services listed in the registration files of `agentIds`. Agents or
 * endpoints that can't be read are skipped, and endpoints for which
 * `isKnown` returns true are not probed.
 */
export async function discoverFromIdentity(
  network: ChainPeNetwork,
  identityRegistry: `0x${string}`,
  agentIds: string[],
  isKnown: (endpoint: string) => boolean = () => false
): Promise<RankedService[]> {
  const client = publicClientFor(network)
  const perAgent = await Promise.all(
    [...new Set(agentIds)].map(async agentId => {
      try {
        const uri = (await client.readContract({
          address: identityRegistry,
          abi: IDENTITY_ABI,
          functionName: 'tokenURI',
          args: [BigInt(agentId)]
        })) as string
        const file = await loadRegistrationFile(uri)
        if (!file) return []
        const services = await Promise.all(
          x402Endpoints(file).filter(e => !isKnown(e)).map(async endpoint => {
            try {
              const offers = await probeOffers(endpoint)
              return serviceFromOffers(
                offers,
                { endpoint, name: file.name, description: file.description, agentId },
                network,
                'erc8004'
              )
            } catch {
              return undefined
            }
          })
        )
        return services.filter((s): s is RankedService => !!s)
      } catch {
        return []
      }
    })
  )
  return perAgent.flat()
}
