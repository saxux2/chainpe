import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { x402HTTPClient } from '@x402/core/client'
import { decodePaymentSignatureHeader } from '@x402/core/http'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerPay } from '../src/tools/pay.js'

// Well-known Hardhat test account #0 (public, not a real secret).
const TEST_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: undefined,
    network: 'arbitrum-sepolia',
    registryAddress: undefined,
    budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
    maxSwapUsd: '25',
    canPay: false,
    mode: 'READ_ONLY',
    reload: vi.fn(),
    ...overrides
  }
}

function payableConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return makeConfig({ canPay: true, privateKey: TEST_KEY, mode: 'ARBITRUM', ...overrides })
}

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.tool).mock.calls
  const call = calls.find(c => c[0] === 'pay')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

const RECIPIENT = '0x1111111111111111111111111111111111111111'

describe('pay tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    registerPay(server, config, new SpendingTracker(config.budget))
    expect(server.tool).toHaveBeenCalledWith(
      'pay',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('rejects payment exceeding per-call budget', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig({ budget: { maxPerCall: '0.01', maxPerDay: '20.00' } })
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.50',
      recipient: RECIPIENT
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
  })

  it('returns a signed x402 v2 PAYMENT-SIGNATURE header', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      resource: 'https://api.example.com/data'
    })) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.headerName).toBe('PAYMENT-SIGNATURE')
    expect(parsed.amount).toBe('0.05 USDC')
    expect(parsed.recipient).toBe(RECIPIENT)
    expect(parsed.network).toBe('arbitrum-sepolia')
    expect(parsed.hint).toContain('PAYMENT-SIGNATURE')

    const payload = decodePaymentSignatureHeader(parsed.paymentHeader)
    expect(payload.x402Version).toBe(2)
    expect(payload.accepted).toMatchObject({
      scheme: 'exact',
      network: 'eip155:421614',
      amount: '50000', // 0.05 * 1e6
      payTo: RECIPIENT,
      asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      extra: { name: 'USD Coin', version: '2' }
    })
    const auth = (payload.payload as { authorization: Record<string, string> }).authorization
    expect(auth.from.toLowerCase()).toBe(TEST_ADDR.toLowerCase())
    expect(auth.value).toBe('50000')
  })

  it("signs payments above x402's default $1 cap when the budget allows it", async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig({ budget: { maxPerCall: '5.00', maxPerDay: '20.00' } })
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({ amount: '2.50', recipient: RECIPIENT })) as {
      isError?: boolean
      content: { text: string }[]
    }
    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0].text)
    expect(decodePaymentSignatureHeader(parsed.paymentHeader).accepted.amount).toBe('2500000')
  })

  it('signs for Arbitrum One when requested', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT,
      network: 'arbitrum'
    })) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    const payload = decodePaymentSignatureHeader(parsed.paymentHeader)
    expect(payload.accepted.network).toBe('eip155:42161')
    expect(payload.accepted.asset).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')
  })

  it('records spending after successful payment', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({ amount: '0.05', recipient: RECIPIENT })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBeCloseTo(0.05)
    expect(summary.recentPayments).toHaveLength(1)
    expect(summary.recentPayments[0].recipient).toBe(RECIPIENT)
  })

  it('returns error when payment signing fails', async () => {
    vi.spyOn(x402HTTPClient.prototype, 'createPaymentPayload').mockRejectedValue(
      new Error('Signing failed')
    )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerPay(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: RECIPIENT
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Signing failed')
  })

  it('does not record spending when payment fails', async () => {
    vi.spyOn(x402HTTPClient.prototype, 'createPaymentPayload').mockRejectedValue(
      new Error('fail')
    )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({ amount: '0.05', recipient: RECIPIENT })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBe(0)
    expect(summary.recentPayments).toHaveLength(0)
  })
})
