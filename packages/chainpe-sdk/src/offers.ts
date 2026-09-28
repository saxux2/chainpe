/**
 * Maps x402 payment offers to services. Shared by the Bazaar and ERC-8004
 * discovery sources.
 */
import type { PaymentRequirements } from '@x402/core/types'
import { formatUnits } from 'viem'
import { getX402Network, findTokenByAddress } from './networks.js'
import type { ChainPeNetwork, RankedService, ServiceSource } from './types.js'

export interface OfferMetadata {
  endpoint: string
  name?: string
  description?: string
  tags?: string[]
  agentId?: string
  updatedAt?: string
}

/**
 * Builds a service from the first `exact` offer on `network` in a stablecoin
 * the SDK knows. Returns undefined when there is none. Pure.
 */
export function serviceFromOffers(
  accepts: readonly PaymentRequirements[],
  meta: OfferMetadata,
  network: ChainPeNetwork,
  source: ServiceSource
): RankedService | undefined {
  const caip2 = getX402Network(network)
  for (const accept of accepts) {
    if (accept.network !== caip2 || accept.scheme !== 'exact') continue
    const token = findTokenByAddress(network, accept.asset)
    if (!token) continue
    const offeredAgentId = accept.extra?.agentId
    const agentId =
      meta.agentId ?? (typeof offeredAgentId === 'string' ? offeredAgentId : undefined)
    return {
      id: `${source}:${meta.endpoint}`,
      name: meta.name || hostOf(meta.endpoint),
      description: meta.description ?? '',
      tags: meta.tags ?? [],
      endpoint: meta.endpoint,
      pricePerRequest: formatUnits(BigInt(accept.amount), token.decimals),
      paymentToken: token.symbol,
      walletAddress: accept.payTo,
      network,
      developer: accept.payTo,
      source,
      agentId: agentId && agentId !== '0' ? agentId : undefined,
      updatedAt: meta.updatedAt,
      reputation: null
    }
  }
  return undefined
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
