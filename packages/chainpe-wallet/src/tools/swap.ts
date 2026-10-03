import { z } from 'zod'
import { formatUnits } from 'viem'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SUPPORTED_NETWORKS } from '@chainpe/sdk'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import { explorerTxUrl } from '@/clients.js'
import {
  executeSwap,
  getSwapQuote,
  swapTokens,
  type SwapQuote
} from '@/swap.js'

const tokenDescription =
  'Token symbol. Arbitrum One: ETH, WETH, USDC, USDT0, ARB, WBTC. ' +
  'Arbitrum Sepolia (testnet): ETH, WETH, USDC.'

function describeQuote(q: SwapQuote) {
  const amountIn = Number(formatUnits(q.amountIn, q.from.decimals))
  const amountOut = Number(formatUnits(q.amountOut, q.to.decimals))
  return {
    network: q.network,
    venue: q.venue,
    route: q.route,
    from: `${formatUnits(q.amountIn, q.from.decimals)} ${q.from.symbol}`,
    to: `${formatUnits(q.amountOut, q.to.decimals)} ${q.to.symbol}`,
    rate: `1 ${q.from.symbol} = ${(amountOut / amountIn).toPrecision(6)} ${q.to.symbol}`,
    inputValueUsd: Number(q.amountInUsd.toFixed(4)),
    ...(q.gasUsd !== undefined && {
      estimatedGasUsd: Number(q.gasUsd.toFixed(4))
    }),
    ...(q.estimated && {
      note: 'Spot-price estimate; swap_tokens simulates the exact output.'
    }),
    ...(q.network !== 'arbitrum' && {
      testnet: 'Arbitrum Sepolia pool prices are not real market prices.'
    })
  }
}

function errorResult(prefix: string, err: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `${prefix}: ${err instanceof Error ? err.message : String(err)}`
      }
    ],
    isError: true
  }
}

const networkArg = z
  .enum(SUPPORTED_NETWORKS as [string, ...string[]])
  .optional()
  .describe("Network (default: the wallet's configured network)")

export function registerSwap(server: McpServer, config: AppConfig): void {
  server.tool(
    'swap_quote',
    'Get a token swap quote on Arbitrum without executing anything. Arbitrum One routes through ' +
      'the KyberSwap aggregator (best price across Uniswap, Camelot, Curve, …); Arbitrum Sepolia uses ' +
      'Uniswap v3. "Arbitrum" as a token means ARB.',
    {
      fromToken: z.string().describe(tokenDescription),
      toToken: z.string().describe(tokenDescription),
      amount: z
        .string()
        .describe('Amount of fromToken as a decimal string, e.g. "1" or "0.5"'),
      network: networkArg
    },
    async ({ fromToken, toToken, amount, network }) => {
      try {
        const net = (network as PaymentNetwork | undefined) ?? config.network
        const quote = await getSwapQuote(net, fromToken, toToken, amount)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(describeQuote(quote), null, 2)
            }
          ]
        }
      } catch (err) {
        return errorResult('Quote failed', err)
      }
    }
  )

  server.tool(
    'swap_tokens',
    'Swap tokens on-chain from your wallet on Arbitrum (real transaction, needs a little ETH for gas). ' +
      'Arbitrum One: any pair of ETH, WETH, USDC, USDT0, ARB, WBTC via KyberSwap. Arbitrum Sepolia: ' +
      'USDC ⇄ ETH/WETH via Uniswap v3 (ARB has no testnet market). Approves only the exact amount, ' +
      'enforces slippage protection and the MAX_SWAP_USD cap. "Arbitrum" as a token means ARB.',
    {
      fromToken: z.string().describe(tokenDescription),
      toToken: z.string().describe(tokenDescription),
      amount: z
        .string()
        .describe('Amount of fromToken as a decimal string, e.g. "1"'),
      slippagePct: z
        .number()
        .min(0.01)
        .max(5)
        .optional()
        .describe('Max slippage in percent (default 1)'),
      network: networkArg
    },
    async ({ fromToken, toToken, amount, slippagePct = 1, network }) => {
      if (!config.privateKey) {
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
        const net = (network as PaymentNetwork | undefined) ?? config.network
        const quote = await getSwapQuote(net, fromToken, toToken, amount)

        const cap = parseFloat(config.maxSwapUsd)
        if (quote.amountInUsd > cap) {
          throw new Error(
            `Swap value $${quote.amountInUsd.toFixed(2)} exceeds the per-swap cap of $${config.maxSwapUsd} ` +
              '(set MAX_SWAP_USD to change it)'
          )
        }

        const result = await executeSwap(quote, config.privateKey, slippagePct)
        const { to, from } = quote
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: result.status === 'success',
                  network: net,
                  venue: quote.venue,
                  route: quote.route,
                  sold: `${formatUnits(result.amountIn, from.decimals)} ${from.symbol}`,
                  expectedReceived: `${formatUnits(result.expectedOut, to.decimals)} ${to.symbol}`,
                  minimumReceived: `${formatUnits(result.minOut, to.decimals)} ${to.symbol}`,
                  slippagePct,
                  txHash: result.txHash,
                  explorerUrl: explorerTxUrl(net, result.txHash),
                  ...(result.approvalTxHash && {
                    approvalTx: explorerTxUrl(net, result.approvalTxHash)
                  }),
                  ...(net !== 'arbitrum' && {
                    testnet:
                      'Arbitrum Sepolia — test tokens, pool prices are not real market prices.'
                  })
                },
                null,
                2
              )
            }
          ],
          ...(result.status !== 'success' && { isError: true })
        }
      } catch (err) {
        return errorResult('Swap failed', err)
      }
    }
  )
}

/** Symbols the swap tools accept on a network (for check_balance etc.). */
export function swapTokenSymbols(network: PaymentNetwork): string[] {
  return Object.keys(swapTokens(network))
}
