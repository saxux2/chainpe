import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { registerGiveFeedback } from '../src/tools/give-feedback.js'

vi.mock('@chainpe/sdk', async importOriginal => ({
  ...(await importOriginal<typeof import('@chainpe/sdk')>()),
  giveFeedback: vi.fn(),
  resolveReputationRegistry: vi.fn()
}))
import { giveFeedback, resolveReputationRegistry } from '@chainpe/sdk'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    privateKey: '0xkey',
    network: 'arbitrum-sepolia',
    budget: { maxPerCall: '1', maxPerDay: '1' },
    canPay: true,
    mode: 'ARBITRUM',
    reload: () => {},
    ...overrides
  }
}

function handler(server: McpServer): (...a: unknown[]) => Promise<unknown> {
  const call = vi.mocked(server.tool).mock.calls.find(c => c[0] === 'give_feedback')
  return call![call!.length - 1] as (...a: unknown[]) => Promise<unknown>
}

const REG = '0x8004B663056A597Dffe9eCcC1965A193B7388713'

describe('give_feedback tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers the tool', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    expect(server.tool).toHaveBeenCalledWith(
      'give_feedback',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('errors when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig({ canPay: false }))
    const r = (await handler(server)({ agentId: '5', score: 100 })) as {
      isError: boolean
      content: { text: string }[]
    }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('No wallet configured')
  })

  it('errors when the provider has no agent id', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(REG)
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({ agentId: '0', score: 100 })) as {
      isError: boolean
      content: { text: string }[]
    }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('no ERC-8004 agent id')
  })

  it('submits an on-chain score and returns the tx hash', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(REG)
    vi.mocked(giveFeedback).mockResolvedValue('0xfeed')
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({ agentId: '5', score: 95, endpoint: 'https://x' })) as {
      content: { text: string }[]
    }
    const parsed = JSON.parse(r.content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.agentId).toBe('5')
    expect(parsed.score).toBe(95)
    expect(parsed.txHash).toBe('0xfeed')
    expect(parsed.explorer).toBe('https://sepolia.arbiscan.io/tx/0xfeed')
    expect(parsed.proofOfPayment).toBe(false)
    expect(vi.mocked(giveFeedback)).toHaveBeenCalledWith(
      'arbitrum-sepolia',
      REG,
      '0xkey',
      expect.objectContaining({ agentId: '5', value: 95, waitConfirm: true, payment: undefined })
    )
  })

  it('attaches a payment proof when given the tx hash and payTo', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(REG)
    vi.mocked(giveFeedback).mockResolvedValue('0xfeed')
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const tx = `0x${'ab'.repeat(32)}`
    const payTo = '0x2222222222222222222222222222222222222222'
    const r = (await handler(server)({ agentId: '5', score: 90, paymentTxHash: tx, payTo })) as {
      content: { text: string }[]
    }
    expect(JSON.parse(r.content[0].text).proofOfPayment).toBe(true)
    expect(vi.mocked(giveFeedback)).toHaveBeenCalledWith(
      'arbitrum-sepolia',
      REG,
      '0xkey',
      expect.objectContaining({ payment: { txHash: tx, payTo } })
    )
  })

  it('rejects a payment tx hash without payTo', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({
      agentId: '5',
      score: 90,
      paymentTxHash: `0x${'ab'.repeat(32)}`
    })) as { isError: boolean; content: { text: string }[] }
    expect(r.isError).toBe(true)
    expect(vi.mocked(giveFeedback)).not.toHaveBeenCalled()
  })

  it('surfaces a self-feedback hint', async () => {
    vi.mocked(resolveReputationRegistry).mockReturnValue(REG)
    vi.mocked(giveFeedback).mockRejectedValue(new Error('Self-feedback not allowed'))
    const server = { tool: vi.fn() } as unknown as McpServer
    registerGiveFeedback(server, makeConfig())
    const r = (await handler(server)({ agentId: '5', score: 100 })) as {
      isError: boolean
      content: { text: string }[]
    }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('cannot rate your own agent')
  })
})
