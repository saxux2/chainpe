import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { giveFeedback, resolveReputationRegistry } from '@chainpe/sdk'
import type { AppConfig } from '@/types.js'
import { explorerTxUrl } from '@/clients.js'

/**
 * give_feedback — post an on-chain reputation score for a provider's agent.
 * Writes to the ERC-8004 Reputation Registry (a real transaction). The score is
 * stored and aggregated on-chain; self-feedback is rejected by the contract.
 */
export function registerGiveFeedback(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'give_feedback',
    'Leave on-chain reputation feedback for a service provider (ERC-8004). Submits a real ' +
      'transaction to the Reputation Registry with a 0–100 score. Use after calling a paid service; ' +
      'pass the agentId shown by search_bazaar, plus the payment tx hash and payTo from x402_fetch so ' +
      'indexers count it as a paying review.',
    {
      agentId: z
        .string()
        .describe(
          "The provider service's ERC-8004 agent id (from search_bazaar)"
        ),
      score: z
        .number()
        .min(0)
        .max(100)
        .describe('Score 0–100 (e.g. 100 = excellent, 0 = bad)'),
      endpoint: z
        .string()
        .optional()
        .describe('The service endpoint the feedback is about'),
      tag: z
        .string()
        .optional()
        .describe('Optional short tag, e.g. "weather" or "accuracy"'),
      paymentTxHash: z
        .string()
        .regex(/^0x[0-9a-fA-F]{64}$/)
        .optional()
        .describe('Settlement tx hash of your payment to this service (proof of payment)'),
      payTo: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .optional()
        .describe('Address your payment went to (required with paymentTxHash)')
    },
    async ({ agentId, score, endpoint, tag, paymentTxHash, payTo }) => {
      if (!config.canPay) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set CHAINPE_PRIVATE_KEY.'
            }
          ],
          isError: true
        }
      }
      if (!agentId || agentId === '0') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'This provider has no ERC-8004 agent id, so it cannot be scored.'
            }
          ],
          isError: true
        }
      }

      if (!!paymentTxHash !== !!payTo) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Pass both paymentTxHash and payTo, or neither.'
            }
          ],
          isError: true
        }
      }

      try {
        const txHash = await giveFeedback(
          config.network,
          resolveReputationRegistry(config.network, config.reputationRegistry),
          config.privateKey!,
          {
            agentId,
            value: score,
            endpoint,
            tag,
            payment: paymentTxHash && payTo ? { txHash: paymentTxHash, payTo } : undefined,
            waitConfirm: true
          }
        )
        const explorer = explorerTxUrl(config.network, txHash)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  agentId,
                  score,
                  txHash,
                  explorer,
                  proofOfPayment: !!paymentTxHash,
                  note: 'Feedback recorded on-chain in the ERC-8004 Reputation Registry.'
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const hint = /self-feedback/i.test(msg)
          ? ' (you cannot rate your own agent)'
          : ''
        return {
          content: [
            { type: 'text' as const, text: `Feedback failed: ${msg}${hint}` }
          ],
          isError: true
        }
      }
    }
  )
}
