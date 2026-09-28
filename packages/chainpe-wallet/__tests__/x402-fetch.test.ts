import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  decodePaymentSignatureHeader
} from '@x402/core/http'
import type { PaymentRequired } from '@x402/core/types'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerX402Fetch } from '../src/tools/x402-fetch.js'

// Feedback is best-effort and hits the chain; keep it out of these tests.
vi.mock('@chainpe/sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('@chainpe/sdk')>()),
  submitPaidCallFeedback: vi.fn().mockResolvedValue(undefined)
}))
import { submitPaidCallFeedback } from '@chainpe/sdk'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Well-known Hardhat test account #0 (public, not a real secret).
const TEST_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const USDC_SEPOLIA = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
const RECIPIENT = '0x1111111111111111111111111111111111111111'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: undefined,
    network: 'arbitrum-sepolia',
    registryAddress: undefined,
    budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
    canPay: false,
    mode: 'READ_ONLY',
    reload: vi.fn(),
    ...overrides
  }
}

function payableConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return makeConfig({ canPay: true, privateKey: TEST_KEY, mode: 'ARBITRUM', ...overrides })
}

function paymentRequired(
  amount: string,
  over: Partial<PaymentRequired['accepts'][number]> = {}
): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: 'https://api.example.com/paid', description: '', mimeType: '' },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:421614',
        asset: USDC_SEPOLIA,
        amount,
        payTo: RECIPIENT,
        maxTimeoutSeconds: 300,
        extra: { name: 'USD Coin', version: '2' },
        ...over
      }
    ]
  }
}

function respond402(pr: PaymentRequired): Response {
  return new Response('{}', {
    status: 402,
    headers: {
      'content-type': 'application/json',
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(pr)
    }
  })
}

function respondText(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain', ...headers }
  })
}

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.tool).mock.calls
  const call = calls.find(c => c[0] === 'x402_fetch')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

type ToolResult = {
  isError?: boolean
  content: { type: string; text: string }[]
}

describe('x402_fetch tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))
    expect(server.tool).toHaveBeenCalledWith(
      'x402_fetch',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/data',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('returns response directly when status is not 402', async () => {
    mockFetch.mockResolvedValue(
      new Response('{"result":"success"}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/free',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.body).toBe('{"result":"success"}')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('handles 402 and retries with a signed PAYMENT-SIGNATURE header', async () => {
    const txHash = '0x' + 'cd'.repeat(32)
    mockFetch.mockResolvedValueOnce(respond402(paymentRequired('50000'))) // 0.05 USDC
    mockFetch.mockResolvedValueOnce(
      respondText(200, 'paid content', {
        'PAYMENT-RESPONSE': encodePaymentResponseHeader({
          success: true,
          transaction: txHash,
          network: 'eip155:421614'
        })
      })
    )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.body).toBe('paid content')
    expect(parsed.payment.amount).toBe('0.050000 USDC')
    expect(parsed.payment.recipient).toBe(RECIPIENT)
    expect(parsed.payment.network).toBe('arbitrum-sepolia')
    expect(parsed.settlement.transaction).toBe(txHash)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    const retryHeaders = mockFetch.mock.calls[1][1].headers as Record<string, string>
    const payload = decodePaymentSignatureHeader(retryHeaders['PAYMENT-SIGNATURE'])
    expect(payload.accepted.network).toBe('eip155:421614')
    expect(payload.accepted.amount).toBe('50000')

    // Auto-feedback carries the settlement as proof of payment.
    expect(vi.mocked(submitPaidCallFeedback)).toHaveBeenCalledWith(
      'arbitrum-sepolia',
      expect.any(String),
      TEST_KEY,
      expect.objectContaining({
        url: 'https://api.example.com/paid',
        payTo: RECIPIENT,
        txHash
      })
    )
  })

  it('returns error when 402 has no accepts', async () => {
    mockFetch.mockResolvedValueOnce(
      respond402({ ...paymentRequired('1'), accepts: [] })
    )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('no payment options')
  })

  it('returns error when wallet cannot fulfill any accepted network', async () => {
    mockFetch.mockResolvedValueOnce(
      respond402(
        paymentRequired('500000', {
          network: 'eip155:84532', // Base Sepolia → not this wallet's network
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
        })
      )
    )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Cannot fulfill payment')
  })

  it('refuses a token that is not on the allowlist', async () => {
    mockFetch.mockResolvedValueOnce(
      respond402(paymentRequired('10000', { asset: '0x000000000000000000000000000000000000dEaD' }))
    )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('unsupported token')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('checks spending limits before signing', async () => {
    mockFetch.mockResolvedValueOnce(respond402(paymentRequired('5000000'))) // 5.0 USDC — over the 1.00 cap

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig({ budget: { maxPerCall: '1.00', maxPerDay: '20.00' } })
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/expensive',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns funding instructions when retry also returns 402 (settle failure)', async () => {
    mockFetch
      .mockResolvedValueOnce(respond402(paymentRequired('20000'))) // 0.02 USDC
      .mockResolvedValueOnce(
        new Response('{}', { status: 402, headers: { 'content-type': 'application/json' } })
      )

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('wallet needs')
    expect(result.content[0].text).toContain('faucet.circle.com')
    expect(parseFloat(spending.getSummary().spentSession)).toBe(0)
    expect(spending.getSummary().recentPayments).toHaveLength(0)
  })

  it('records spending after successful paid fetch', async () => {
    mockFetch
      .mockResolvedValueOnce(respond402(paymentRequired('50000')))
      .mockResolvedValueOnce(respondText(200, 'result'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({ url: 'https://api.example.com/paid', method: 'GET' })

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBeCloseTo(0.05)
    expect(summary.recentPayments).toHaveLength(1)
    expect(summary.recentPayments[0].recipient).toBe(RECIPIENT)
  })

  it('passes custom headers and body to fetch', async () => {
    mockFetch.mockResolvedValue(respondText(200, 'ok'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    await handler({
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}'
    })

    const [, options] = mockFetch.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.body).toBe('{"key":"value"}')
  })

  it('handles fetch network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = payableConfig()
    registerX402Fetch(server, config, new SpendingTracker(config.budget))

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/down',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network error')
  })
})
