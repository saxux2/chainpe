/**
 * search_bazaar tool — discover x402-gated services from the ChainPe on-chain
 * registry, Coinbase's x402 Bazaar and ERC-8004 registration files.
 *
 * Lets the agent see which paid APIs are available, with their price and the
 * endpoint to hand to `x402_fetch` for automatic payment.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  discoverServices,
  findRegistryAddress,
  resolveIdentityRegistry,
  resolveReputationRegistry,
  type ServiceSource
} from '@chainpe/sdk'
import type { AppConfig } from '@/types.js'

const SOURCE_LABEL: Record<ServiceSource, string> = {
  registry: 'ChainPe registry',
  bazaar: 'Coinbase Bazaar',
  erc8004: 'ERC-8004'
}

export function registerBazaarSearch(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'search_bazaar',
    'Discover x402-gated services on Arbitrum from the ChainPe on-chain registry and Coinbase\'s ' +
      'x402 Bazaar. Returns each service with its description, price, tags, reputation, and endpoint URL. ' +
      'To use a service, pass its endpoint to the `x402_fetch` tool, which handles the payment automatically.',
    {
      query: z
        .string()
        .optional()
        .describe(
          'Search text, e.g. "weather", "btc price" (matched by name/description/tag in the registry, semantically in the Bazaar). Coinbase Bazaar results need a query or tags; without them only the ChainPe registry is listed.'
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional list of tags to filter by (matches any)'),
      maxPrice: z
        .string()
        .optional()
        .describe(
          'Optional maximum price per request as a decimal string, e.g. "0.05"'
        )
    },
    async ({ query, tags, maxPrice }) => {
      try {
        const registryAddress = findRegistryAddress(config.network, config.registryAddress)
        const services = await discoverServices(
          config.network,
          { query, tags, maxPrice },
          {
            registryAddress,
            reputationRegistry: resolveReputationRegistry(config.network, config.reputationRegistry),
            identityRegistry: resolveIdentityRegistry(config.network)
          }
        )

        if (services.length === 0) {
          const where = query ? ` matching "${query}"` : ''
          return {
            content: [
              {
                type: 'text' as const,
                text: `No x402 services found${where} on ${config.network}.`
              }
            ]
          }
        }

        const serviceList = services
          .map((s, i) => {
            const rep = s.reputation
            let repLine = ''
            if (s.agentId) {
              repLine =
                rep && rep.count > 0 && rep.score !== null
                  ? `  ·  ⭐ ${rep.score.toFixed(0)}/100 (${rep.count} ${rep.verified ? 'paying ' : ''}review${rep.count === 1 ? '' : 's'}${rep.verified ? '' : ', unverified'})`
                  : '  ·  ⭐ no ratings yet'
            }
            return (
              `${i + 1}. ${s.name} — ${s.description}\n` +
              `   Price: ${s.pricePerRequest} ${s.paymentToken}` +
              (s.tags.length ? `  ·  Tags: ${s.tags.join(', ')}` : '') +
              (s.agentId ? `  ·  Agent ID: ${s.agentId}` : '') +
              repLine +
              `  ·  Source: ${SOURCE_LABEL[s.source]}` +
              `\n   Endpoint: ${s.endpoint}`
            )
          })
          .join('\n\n')

        const header = query
          ? `Found ${services.length} service(s) matching "${query}":`
          : `Found ${services.length} service(s):`

        const summary =
          `\n\n📋 Network: ${config.network}` +
          (registryAddress ? `  ·  Registry: ${registryAddress}` : '  ·  Registry: not configured (Bazaar only)') +
          `\nHint: call x402_fetch with a service's Endpoint to pay and fetch its result.`

        return {
          content: [
            {
              type: 'text' as const,
              text: `${header}\n\n${serviceList}${summary}`
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Service discovery failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            }
          ],
          isError: true
        }
      }
    }
  )
}
