import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PaymentRequired } from '@x402/core/types'
import { DEFAULT_ASSETS } from '@x402/evm'
import { SUPPORTED_NETWORKS } from '@chainpe/sdk'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import {
  buildPaymentClient,
  getX402Network,
  getUsdcAddress,
  USDC_DECIMALS
} from '@/clients.js'

const X402_VERSION = 2

export function registerPay(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'pay',
    'Sign and create an x402 v2 payment header (USDC EIP-3009 transfer authorization) on Arbitrum. ' +
      'Returns the PAYMENT-SIGNATURE header value to attach to your HTTP request.',
    {
      amount: z.string().describe('USDC amount as decimal string, e.g. "0.05"'),
      recipient: z.string().describe('Recipient EVM address (0x…)'),
      network: z
        .enum(SUPPORTED_NETWORKS as [string, ...string[]])
        .optional()
        .describe("Payment network (default: the wallet's configured network)"),
      resource: z
        .string()
        .optional()
        .describe('URL of the resource being paid for')
    },
    async ({ amount, recipient, network, resource }) => {
      if (!config.canPay) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set CHAINPE_PRIVATE_KEY to sign payments.'
            }
          ],
          isError: true
        }
      }

      const net = (network as PaymentNetwork | undefined) ?? config.network

      try {
        spending.check(amount)

        const client = buildPaymentClient(net, config)
        const caip2 = getX402Network(net)
        const asset = DEFAULT_ASSETS[caip2]?.[0]

        const paymentRequired: PaymentRequired = {
          x402Version: X402_VERSION,
          resource: { url: resource ?? 'https://chainpe.x402/pay', description: '', mimeType: '' },
          accepts: [
            {
              scheme: 'exact',
              network: caip2,
              amount: toAtomicUnits(amount),
              payTo: recipient,
              maxTimeoutSeconds: 300,
              asset: getUsdcAddress(net),
              extra: { name: asset?.name ?? 'USD Coin', version: asset?.version ?? '2' }
            }
          ]
        }

        const paymentPayload = await client.createPaymentPayload(paymentRequired)
        const [[headerName, headerValue]] = Object.entries(
          client.encodePaymentSignatureHeader(paymentPayload)
        )

        if (!headerValue) {
          throw new Error('Failed to generate payment header')
        }

        spending.record(amount, recipient, net)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  paymentHeader: headerValue,
                  headerName,
                  amount: `${amount} USDC`,
                  recipient,
                  network: net,
                  resource: resource ?? null,
                  hint: `Set this as the ${headerName} header in your HTTP request.`
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Payment failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}

function toAtomicUnits(amount: string): string {
  const parts = amount.split('.')
  const whole = parts[0] || '0'
  const frac = (parts[1] || '')
    .padEnd(USDC_DECIMALS, '0')
    .slice(0, USDC_DECIMALS)
  return (BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(frac)).toString()
}
