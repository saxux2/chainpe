import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import {
  applySlippage,
  getSwapQuote,
  resolveSwapToken,
  spotAmountOut
} from '../src/swap.js'
import { registerSwap } from '../src/tools/swap.js'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: '0x' + '11'.repeat(32),
    network: 'arbitrum',
    registryAddress: undefined,
    budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
    maxSwapUsd: '25',
    canPay: true,
    mode: 'ARBITRUM',
    reload: vi.fn(),
    ...overrides
  }
}

function handlerFor(server: McpServer, name: string) {
  const call = vi.mocked(server.tool).mock.calls.find(c => c[0] === name)
  return call![call!.length - 1] as (args: unknown) => Promise<{
    isError?: boolean
    content: { text: string }[]
  }>
}

describe('resolveSwapToken', () => {
  it('maps "arbitrum" to ARB on Arbitrum One', () => {
    expect(resolveSwapToken('arbitrum', 'arbitrum').symbol).toBe('ARB')
    expect(resolveSwapToken('arbitrum', 'usdc').decimals).toBe(6)
  })

  it('maps ARB to the tARB stand-in on Arbitrum Sepolia', () => {
    expect(resolveSwapToken('arbitrum-sepolia', 'arbitrum').symbol).toBe('tARB')
    expect(resolveSwapToken('arbitrum-sepolia', 'tARB').symbol).toBe('tARB')
  })

  it('explains mainnet-only tokens on testnet', () => {
    expect(() => resolveSwapToken('arbitrum-sepolia', 'WBTC')).toThrow(
      /no market on Arbitrum Sepolia/
    )
  })

  it('rejects unknown tokens', () => {
    expect(() => resolveSwapToken('arbitrum', 'DOGE')).toThrow(/Unknown token/)
  })
})

describe('swap math', () => {
  it('spotAmountOut handles both directions and the pool fee', () => {
    const sqrtP = 2n ** 96n * 2n // price token1/token0 = 4
    expect(spotAmountOut(1_000_000n, sqrtP, true, 0)).toBe(4_000_000n)
    expect(spotAmountOut(4_000_000n, sqrtP, false, 0)).toBe(1_000_000n)
    expect(spotAmountOut(1_000_000n, sqrtP, true, 3000)).toBe(3_988_000n)
  })

  it('applySlippage takes basis points off', () => {
    expect(applySlippage(10_000n, 1)).toBe(9_900n)
    expect(applySlippage(10_000n, 0.5)).toBe(9_950n)
  })
})

describe('getSwapQuote (KyberSwap)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses a KyberSwap route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
            routeSummary: {
              amountOut: '5000000000000000000',
              amountInUsd: '1.0',
              gasUsd: '0.01',
              route: [[{ exchange: 'uniswap-v3' }, { exchange: 'camelot' }]]
            }
          }
        })
      })
    )
    const q = await getSwapQuote('arbitrum', 'USDC', 'ARB', '1')
    expect(q.venue).toBe('KyberSwap')
    expect(q.amountIn).toBe(1_000_000n)
    expect(q.amountOut).toBe(5n * 10n ** 18n)
    expect(q.route).toEqual(['uniswap-v3', 'camelot'])
  })

  it('rejects swapping a token to itself', async () => {
    await expect(getSwapQuote('arbitrum', 'USDC', 'usdc', '1')).rejects.toThrow(
      /itself/
    )
  })
})

describe('swap_tokens tool', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('registers swap_quote and swap_tokens', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerSwap(server, makeConfig())
    const names = vi.mocked(server.tool).mock.calls.map(c => c[0])
    expect(names).toEqual(['swap_quote', 'swap_tokens'])
  })

  it('requires a wallet', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerSwap(server, makeConfig({ privateKey: undefined }))
    const res = await handlerFor(
      server,
      'swap_tokens'
    )({
      fromToken: 'USDC',
      toToken: 'ARB',
      amount: '1'
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('No wallet configured')
  })

  it('enforces the MAX_SWAP_USD cap before sending anything', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          routeSummary: {
            amountOut: '1',
            amountInUsd: '100',
            gasUsd: '0',
            route: []
          }
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const server = { tool: vi.fn() } as unknown as McpServer
    registerSwap(server, makeConfig({ maxSwapUsd: '25' }))
    const res = await handlerFor(
      server,
      'swap_tokens'
    )({
      fromToken: 'USDC',
      toToken: 'ARB',
      amount: '100'
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/exceeds the per-swap cap/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // quote only, no build
  })
})
