import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PaymentRequired } from '@x402/core/types'
import {
  getNetworkConfig,
  findTokenByAddress,
  findRegistryAddress,
  resolveReputationRegistry,
  submitPaidCallFeedback
} from '@chainpe/sdk'
import type { AppConfig } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import { buildPaymentClient, getX402Network } from '@/clients.js'

/** ChainPe extension (3b) carried on the 402 body: the provider's ERC-8004 agent id. */
interface ChainPeBodyExtension {
  agentId?: string
}

function isLikelyTextContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const n = contentType.toLowerCase()
  return (
    n.startsWith('text/') ||
    n.includes('application/json') ||
    n.includes('application/xml') ||
    n.includes('application/javascript') ||
    n.includes('application/x-www-form-urlencoded')
  )
}

async function formatResponseBody(response: Response): Promise<{
  body: string
  bodyEncoding: 'text' | 'base64'
  contentType: string | null
  contentLength: string | null
}> {
  const contentType = response.headers.get('content-type')
  const contentLength = response.headers.get('content-length')
  if (isLikelyTextContentType(contentType)) {
    return {
      body: await response.text(),
      bodyEncoding: 'text',
      contentType,
      contentLength
    }
  }
  const arrayBuffer = await response.arrayBuffer()
  return {
    body: Buffer.from(arrayBuffer).toString('base64'),
    bodyEncoding: 'base64',
    contentType,
    contentLength
  }
}

function atomicToHuman(atomic: string, decimals: number): string {
  const raw = BigInt(atomic)
  const whole = raw / BigInt(10 ** decimals)
  const frac = raw % BigInt(10 ** decimals)
  return `${whole}.${frac.toString().padStart(decimals, '0')}`
}

export function registerX402Fetch(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'x402_fetch',
    'Fetch a URL with automatic x402 payment. Makes the HTTP request, and if the server responds ' +
      'with 402 Payment Required, automatically signs the stablecoin payment (USDC or USDT0, EIP-3009, x402 v2) on Arbitrum ' +
      'and retries with the PAYMENT-SIGNATURE header. Returns the final response.',
    {
      url: z.string().url().describe('The URL to fetch'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
        .default('GET')
        .describe('HTTP method (default: GET)'),
      headers: z
        .record(z.string())
        .optional()
        .describe('Optional HTTP headers'),
      body: z.string().optional().describe('Optional request body')
    },
    async ({ url, method, headers, body }) => {
      if (!config.canPay) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set CHAINPE_PRIVATE_KEY environment variable.'
            }
          ],
          isError: true
        }
      }

      try {
        const baseOptions: RequestInit = { method, headers: headers ?? {} }
        if (body && method !== 'GET') baseOptions.body = body

        const initial = await fetch(url, baseOptions)
        if (initial.status !== 402) {
          const payload = await formatResponseBody(initial)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    status: initial.status,
                    statusText: initial.statusText,
                    body: payload.body,
                    bodyEncoding: payload.bodyEncoding,
                    contentType: payload.contentType,
                    contentLength: payload.contentLength
                  },
                  null,
                  2
                )
              }
            ]
          }
        }

        // Parse the 402 (x402 v2: PAYMENT-REQUIRED header; v1 servers use the body).
        const paymentClient = buildPaymentClient(config.network, config)
        const initialBody = (await initial.json().catch(() => undefined)) as
          | (Partial<PaymentRequired> & ChainPeBodyExtension)
          | undefined
        let paymentRequired: PaymentRequired
        try {
          paymentRequired = paymentClient.getPaymentRequiredResponse(
            name => initial.headers.get(name),
            initialBody
          )
        } catch {
          paymentRequired = { x402Version: 2, resource: { url }, accepts: [] } as unknown as PaymentRequired
        }
        if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Server returned 402 but provided no payment options.'
              }
            ],
            isError: true
          }
        }

        const network = config.network
        const caip2 = getX402Network(network)
        const onNetwork = paymentRequired.accepts.filter(
          a => a.network === caip2 && a.scheme === 'exact'
        )

        if (onNetwork.length === 0) {
          const nets = paymentRequired.accepts.map(a => a.network).join(', ')
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot fulfill payment. Server accepts: [${nets}], wallet is on ${network} (${caip2}).`
              }
            ],
            isError: true
          }
        }

        // Only pay in known stablecoins — budgets are in dollars and would be
        // meaningless for an arbitrary token.
        const accept = onNetwork.find(a => findTokenByAddress(network, a.asset))
        if (!accept) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot fulfill payment. Server asks for unsupported token(s) [${onNetwork
                  .map(a => a.asset)
                  .join(', ')}] on ${network}.`
              }
            ],
            isError: true
          }
        }
        const token = findTokenByAddress(network, accept.asset)!
        const usdcAmount = atomicToHuman(accept.amount, token.decimals)

        spending.check(usdcAmount)

        const paymentPayload = await paymentClient.createPaymentPayload({
          ...paymentRequired,
          accepts: [accept]
        })
        const paymentHeaders = paymentClient.encodePaymentSignatureHeader(paymentPayload)

        const retryOptions: RequestInit = {
          method,
          headers: { ...(headers ?? {}), ...paymentHeaders }
        }
        if (body && method !== 'GET') retryOptions.body = body

        const paid = await fetch(url, retryOptions)
        const payload = await formatResponseBody(paid)

        if (paid.status === 402) {
          const { name, faucetUrl } = getNetworkConfig(network)
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  'Payment signed and sent, but the server could not settle the transaction.',
                  'This usually means the paying wallet needs:',
                  `  1. ${token.symbol} on ${name} — at least ${usdcAmount} ${token.symbol}`,
                  '  2. (the facilitator pays gas, so you do not need ETH to pay)',
                  ...(faucetUrl
                    ? ['', `Get testnet USDC: ${faucetUrl} (select ${name})`]
                    : []),
                  '',
                  `Attempted payment: ${usdcAmount} ${token.symbol} → ${accept.payTo} on ${network}`
                ].join('\n')
              }
            ],
            isError: true
          }
        }

        spending.record(usdcAmount, accept.payTo, network)

        let settlement: { transaction?: string } | undefined
        try {
          settlement = paymentClient.getPaymentSettleResponse(name => paid.headers.get(name))
        } catch {
          /* no (or undecodable) settlement header */
        }

        // On-chain reputation: leave a positive score for the provider's
        // ERC-8004 agent, with the settlement as proof of payment. Best-effort
        // — never fails the fetch. 3b: prefer the agent id advertised on the 402.
        const feedback = await submitPaidCallFeedback(
          network,
          resolveReputationRegistry(network, config.reputationRegistry),
          config.privateKey!,
          {
            url,
            payTo: accept.payTo,
            txHash: settlement?.transaction || undefined,
            agentId:
              initial.headers.get('x-chainpe-agent-id') ??
              initialBody?.agentId ??
              (accept.extra?.agentId as string | undefined),
            registryAddress: findRegistryAddress(network, config.registryAddress)
          }
        )

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  status: paid.status,
                  statusText: paid.statusText,
                  body: payload.body,
                  bodyEncoding: payload.bodyEncoding,
                  contentType: payload.contentType,
                  contentLength: payload.contentLength,
                  payment: {
                    amount: `${usdcAmount} ${token.symbol}`,
                    recipient: accept.payTo,
                    network
                  },
                  settlement: settlement ?? undefined,
                  reputation: feedback
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
              text: `x402 fetch failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
