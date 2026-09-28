import { describe, it, expect } from 'vitest'
import {
  serviceRowFromArgs,
  feedbackRowFromArgs,
  aggregateReputation,
  rankServices,
  type ServiceEventArgs,
  type FeedbackEventArgs
} from '../src/core.js'

const svcArgs: ServiceEventArgs = {
  key: '0xabc',
  developer: '0xDev',
  name: 'translate',
  endpoint: 'https://t/translate',
  pricePerRequest: '0.01',
  paymentToken: '',
  payTo: '0xPay',
  agentId: 5n
}

describe('serviceRowFromArgs', () => {
  it('maps args + merges description/tags from extra; defaults token to USDC', () => {
    const row = serviceRowFromArgs(svcArgs, 100n, { description: 'd', tags: 'ai,nlp' })
    expect(row.key).toBe('0xabc')
    expect(row.agentId).toBe('5')
    expect(row.paymentToken).toBe('USDC')
    expect(row.description).toBe('d')
    expect(row.tags).toBe('ai,nlp')
    expect(row.active).toBe(true)
    expect(row.updatedBlock).toBe(100n)
  })

  it('treats agentId 0 as null and missing extra as empty', () => {
    const row = serviceRowFromArgs({ ...svcArgs, agentId: 0n }, 1n)
    expect(row.agentId).toBeNull()
    expect(row.description).toBe('')
    expect(row.tags).toBe('')
  })
})

describe('feedbackRowFromArgs', () => {
  it('converts bigints/decimals and nulls empty tags', () => {
    const args: FeedbackEventArgs = {
      agentId: 5n,
      clientAddress: '0xClient',
      feedbackIndex: 2n,
      value: 90n,
      valueDecimals: 0,
      tag1: 'x402',
      tag2: ''
    }
    const row = feedbackRowFromArgs(args, 50n)
    expect(row).toMatchObject({
      agentId: '5',
      client: '0xClient',
      feedbackIndex: 2n,
      value: 90,
      valueDecimals: 0,
      tag1: 'x402',
      tag2: null,
      revoked: false,
      verified: false,
      paymentTx: null,
      block: 50n
    })
  })
})

describe('aggregateReputation', () => {
  const fb = (client: string, value: number, extra: { verified?: boolean; revoked?: boolean; valueDecimals?: number } = {}) => ({
    value,
    valueDecimals: extra.valueDecimals ?? 0,
    client,
    revoked: extra.revoked ?? false,
    verified: extra.verified ?? true
  })

  it('returns unscored for no live feedback', () => {
    expect(aggregateReputation([])).toEqual({ count: 0, score: null, unverifiedCount: 0 })
    expect(aggregateReputation([fb('0xa', 100, { revoked: true })])).toEqual({
      count: 0,
      score: null,
      unverifiedCount: 0
    })
  })

  it('counts distinct clients and averages decimal-adjusted values', () => {
    const out = aggregateReputation([
      fb('0xA', 80),
      fb('0xa', 100), // same client (case)
      fb('0xB', 9000, { valueDecimals: 2 }) // = 90
    ])
    expect(out.count).toBe(2)
    expect(out.score).toBe(90) // (80 + 100 + 90) / 3
  })

  it('scores verified feedback only and reports the rest', () => {
    const out = aggregateReputation([
      fb('0xA', 90),
      fb('0xS1', 0, { verified: false }), // Sybil wallets without payment proof
      fb('0xS2', 0, { verified: false }),
      fb('0xS3', 0, { verified: false, revoked: true })
    ])
    expect(out).toEqual({ count: 1, score: 90, unverifiedCount: 2 })
  })

  it('leaves an agent with only unverified feedback unscored', () => {
    expect(aggregateReputation([fb('0xS', 100, { verified: false })])).toEqual({
      count: 0,
      score: null,
      unverifiedCount: 1
    })
  })
})

describe('rankServices', () => {
  it('orders scored before unscored, then by score/count/price', () => {
    const ranked = rankServices([
      { pricePerRequest: '0.1', reputation: null },
      { pricePerRequest: '0.2', reputation: { score: 40, count: 1, unverifiedCount: 0 } },
      { pricePerRequest: '0.3', reputation: { score: 90, count: 5, unverifiedCount: 0 } }
    ])
    expect(ranked.map(s => s.reputation?.score ?? 'none')).toEqual([90, 40, 'none'])
  })
})
