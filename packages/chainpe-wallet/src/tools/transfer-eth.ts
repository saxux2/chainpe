/**
 * transfer_eth — Send native ETH from the agent wallet to any address.
 *
 * Unlike transfer_usdc (which moves an ERC-20), this moves Arbitrum's native
 * gas token. Use it to pay gas for another wallet or move value in ETH.
 */
import { z } from 'zod'
import { createWalletClient, http, getAddress, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SUPPORTED_NETWORKS, normalizeKey } from '@chainpe/sdk'
import type { AppConfig } from '@/types.js'
import { rpcUrlFor, publicClientFor, chainFor, explorerTxUrl } from '@/clients.js'

export function registerTransferEth(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'transfer_eth',
    'Send native ETH on Arbitrum from this agent wallet to another address. Use this to pay for gas, ' +
      'seed a new wallet, or transfer value in ETH. For USDC transfers, use transfer_usdc instead.',
    {
      to: z.string().describe('Recipient EVM address (0x…)'),
      amount: z
        .string()
        .describe('Amount of ETH as decimal string, e.g. "0.01"'),
      network: z
        .enum(SUPPORTED_NETWORKS as [string, ...string[]])
        .optional()
        .describe("Network (default: the wallet's configured network)")
    },
    async ({ to, amount, network }) => {
      if (!config.privateKey) {
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

      try {
        const net = (network as AppConfig['network'] | undefined) ?? config.network
        const account = privateKeyToAccount(normalizeKey(config.privateKey))
        const walletClient = createWalletClient({
          account,
          chain: chainFor(net),
          transport: http(rpcUrlFor(net))
        })

        const value = parseEther(amount)
        if (value <= 0n) {
          return {
            content: [
              { type: 'text' as const, text: 'Amount must be greater than 0.' }
            ],
            isError: true
          }
        }

        const recipient = getAddress(to)
        const hash = await walletClient.sendTransaction({
          to: recipient,
          value
        })
        const receipt = await publicClientFor(net).waitForTransactionReceipt({
          hash
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: receipt.status === 'success',
                  txHash: hash,
                  from: account.address,
                  to: recipient,
                  amount: `${amount} ETH`,
                  network: net,
                  blockNumber: Number(receipt.blockNumber),
                  explorerUrl: explorerTxUrl(net, hash)
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
              text: `Transfer failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
