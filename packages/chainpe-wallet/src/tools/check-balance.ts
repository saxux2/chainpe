import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import {
  getWalletAddress,
  getUsdcBalance,
  getEthBalance,
  getTokenBalances
} from '@/clients.js'
import { swapTokens } from '@/swap.js'

export function registerCheckBalance(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'check_balance',
    'Check wallet balances on Arbitrum: USDC, native ETH (for gas), and any other swappable tokens held (WETH, ARB, …).',
    {},
    async () => {
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
        const address = getWalletAddress(config)
        const otherTokens = Object.values(swapTokens(config.network)).filter(
          t => !t.native && t.symbol !== 'USDC'
        )
        const [usdc, eth, tokens] = await Promise.all([
          getUsdcBalance(config.network, config),
          getEthBalance(config.network, address),
          getTokenBalances(config.network, address, otherTokens).catch(
            () => ({})
          )
        ])

        const result = {
          address,
          network: config.network,
          mode: config.mode,
          usdc: `${usdc} USDC`,
          eth: `${eth} ETH`,
          ...(Object.keys(tokens).length > 0 && { tokens }),
          gasNote:
            'ETH is needed for native transfers and gas. x402 USDC payments are gasless for you — the facilitator pays gas.'
        }

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
