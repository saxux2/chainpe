import { describe, it, expect, vi, afterEach } from 'vitest'
import { keccak256, toBytes } from 'viem'
import {
  summaryToScore,
  getReputation,
  canonicalJson,
  buildFeedbackFile,
  encodeFeedbackFile
} from '../src/reputation.js'

const CLIENT = '0x1111111111111111111111111111111111111111'
const PAY_TO = '0x2222222222222222222222222222222222222222'
const TX = `0x${'ab'.repeat(32)}`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('summaryToScore', () => {
  it('applies the on-chain decimals', () => {
    expect(summaryToScore(95n, 0)).toBe(95)
    expect(summaryToScore(9500n, 2)).toBe(95)
    expect(summaryToScore(0n, 0)).toBe(0)
  })
})

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}'
    )
  })
})

describe('feedback files', () => {
  const at = new Date('2026-09-28T00:00:00Z')

  it('carries an ERC-8004 proofOfPayment when a payment is given', () => {
    const file = buildFeedbackFile(
      'arbitrum',
      CLIENT,
      { agentId: '7', value: 99.6, tag: 'x402-success', endpoint: 'https://api.x', payment: { txHash: TX, payTo: PAY_TO } },
      at
    )
    expect(file).toEqual({
      agentRegistry: 'eip155:42161:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: 7,
      clientAddress: `eip155:42161:${CLIENT}`,
      createdAt: '2026-09-28T00:00:00.000Z',
      value: 100,
      valueDecimals: 0,
      tag1: 'x402',
      tag2: 'x402-success',
      endpoint: 'https://api.x',
      proofOfPayment: { fromAddress: CLIENT, toAddress: PAY_TO, chainId: '42161', txHash: TX }
    })
  })

  it('omits the proof without a payment', () => {
    const file = buildFeedbackFile('arbitrum-sepolia', CLIENT, { agentId: '7', value: 50 }, at)
    expect(file.proofOfPayment).toBeUndefined()
    expect(file.tag2).toBe('paid-call')
  })

  it('hashes the exact bytes inside the data: URI', () => {
    const file = buildFeedbackFile('arbitrum', CLIENT, { agentId: '7', value: 100 }, at)
    const { json, feedbackURI, feedbackHash } = encodeFeedbackFile(file)
    const b64 = feedbackURI.replace('data:application/json;base64,', '')
    const decoded = Buffer.from(b64, 'base64').toString('utf8')
    expect(decoded).toBe(json)
    expect(JSON.parse(decoded)).toEqual(JSON.parse(JSON.stringify(file)))
    expect(feedbackHash).toBe(keccak256(toBytes(decoded)))
  })
})

describe('getReputation', () => {
  const reg = '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4' as const

  it('returns null for unlinked agents (id 0 / empty)', async () => {
    expect(await getReputation('arbitrum-sepolia', reg, '0')).toBeNull()
    expect(await getReputation('arbitrum-sepolia', reg, '')).toBeNull()
  })

  it('returns null when neither an indexer nor a registry is configured', async () => {
    expect(await getReputation('arbitrum-sepolia', undefined, '5', { indexerUrl: null })).toBeNull()
  })

  it('reads the verified score from the indexer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ network: 'arbitrum-sepolia', agentId: '5', count: 3, score: 92, unverifiedCount: 4 })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('CHAINPE_INDEXER_URL', 'https://indexer.test/')

    expect(await getReputation('arbitrum-sepolia', undefined, '5')).toEqual({
      count: 3,
      score: 92,
      verified: true,
      unverifiedCount: 4
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://indexer.test/agents/5/reputation')
  })

  it('ignores an indexer serving another network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ network: 'arbitrum', count: 3, score: 92 })))
    )
    expect(
      await getReputation('arbitrum-sepolia', undefined, '5', { indexerUrl: 'https://indexer.test' })
    ).toBeNull()
  })

  it('ignores an unreachable indexer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    expect(
      await getReputation('arbitrum-sepolia', undefined, '5', { indexerUrl: 'https://indexer.test' })
    ).toBeNull()
  })
})
