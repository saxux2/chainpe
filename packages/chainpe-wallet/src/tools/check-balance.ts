import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { getWalletAddress, getUsdcBalance, getEthBalance } from '@/clients.js'

export function registerCheckBalance(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'check_balance',
    'Check wallet balances on Arbitrum: USDC and native ETH (for gas).',
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
        const [usdc, eth] = await Promise.all([
          getUsdcBalance(config.network, config),
          getEthBalance(config.network, address)
        ])

        const result = {
          address,
          network: config.network,
          mode: config.mode,
          usdc: `${usdc} USDC`,
          eth: `${eth} ETH`,
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
