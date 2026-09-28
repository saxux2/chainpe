import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  decodePaymentSignatureHeader
} from '@x402/core/http'
import type { PaymentRequired } from '@x402/core/types'
import { ChainPe } from '../src/chainpe.js'

// Well-known Hardhat test account #0 (public, not a real secret).
const TEST_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const PAY_TO = '0x1111111111111111111111111111111111111111'
const SEPOLIA_USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'

afterEach(() => {
  vi.unstubAllGlobals()
})

function paymentRequired(over: Partial<PaymentRequired['accepts'][number]> = {}): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: 'https://api.example.com/paid', description: 'paid', mimeType: 'application/json' },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:421614',
        asset: SEPOLIA_USDC,
        amount: '10000', // 0.01 USDC
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
        ...over
      }
    ]
  }
}

function respond402(pr: PaymentRequired): Response {
  return new Response(JSON.stringify({}), {
    status: 402,
    headers: {
      'content-type': 'application/json',
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(pr)
    }
  })
}

describe('ChainPe construction', () => {
  it('requires a private key', () => {
    // @ts-expect-error intentional misuse
    expect(() => new ChainPe({})).toThrow(/privateKey/)
  })

  it('derives the wallet address and defaults to Arbitrum One', () => {
    const cp = new ChainPe({ privateKey: TEST_KEY })
    expect(cp.getAddress().toLowerCase()).toBe(TEST_ADDR.toLowerCase())
    expect(cp.network).toBe('arbitrum')
    // Canonical ERC-8004 Reputation Registry on Arbitrum One (checksummed).
    expect(cp.reputationRegistry).toBe(
      '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
    )
  })

  it('does not require a registry address until discovery is used', async () => {
    const prev = process.env.CHAINPE_REGISTRY_ADDRESS
    delete process.env.CHAINPE_REGISTRY_ADDRESS
    try {
      const cp = new ChainPe({ privateKey: TEST_KEY })
      expect(cp.registryAddress).toBeUndefined()
      // Registry-only discovery needs the address; the default merges in the Bazaar.
      await expect(cp.discover({ sources: ['registry'] })).rejects.toThrow(/CHAINPE_REGISTRY_ADDRESS/)
    } finally {
      if (prev !== undefined) process.env.CHAINPE_REGISTRY_ADDRESS = prev
    }
  })

  it('echoes config including maxPerCall default of 1 USDC', () => {
    const cp = new ChainPe({ privateKey: TEST_KEY })
    expect(cp.config.maxPerCall).toBe('1')
    expect(cp.config.network).toBe('arbitrum')
  })
})

describe('ChainPe.fetch / pay', () => {
  it('passes non-402 responses straight through (no payment)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ hello: 'world' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    const cp = new ChainPe({ privateKey: TEST_KEY })
    const res = await cp.fetch('https://api.example.com/free')
    expect(res.status).toBe(200)

    const paid = await cp.pay<{ hello: string }>('https://api.example.com/free')
    expect(paid.ok).toBe(true)
    expect(paid.data.hello).toBe('world')
    expect(paid.payment).toBeUndefined()
  })

  it('rejects a 402 that demands more than maxPerCall', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond402(paymentRequired({ amount: '5000000' }))) // 5 USDC > 1 cap
    )
    const cp = new ChainPe({ privateKey: TEST_KEY, network: 'arbitrum-sepolia', maxPerCall: '1' })
    await expect(cp.fetch('https://api.example.com/paid')).rejects.toThrow(
      /exceeds maxPerCall/
    )
  })

  it('errors when the server accepts only foreign networks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond402(paymentRequired({ network: 'eip155:8453' })))
    )
    const cp = new ChainPe({ privateKey: TEST_KEY, network: 'arbitrum-sepolia' })
    await expect(cp.fetch('https://api.example.com/paid')).rejects.toThrow(
      /wallet is on arbitrum-sepolia/
    )
  })

  it("pays above x402's default $1 cap when maxPerCall allows it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).get('PAYMENT-SIGNATURE')
        ? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
        : respond402(paymentRequired({ amount: '5000000' })) // 5 USDC
    )
    vi.stubGlobal('fetch', fetchMock)
    const cp = new ChainPe({ privateKey: TEST_KEY, network: 'arbitrum-sepolia', maxPerCall: '10' })
    const result = await cp.pay('https://api.example.com/paid')
    expect(result.payment?.amount).toBe('5')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses to pay in a token that is not on the allowlist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond402(paymentRequired({ asset: '0x000000000000000000000000000000000000dEaD' })))
    )
    const cp = new ChainPe({ privateKey: TEST_KEY, network: 'arbitrum-sepolia' })
    await expect(cp.fetch('https://api.example.com/paid')).rejects.toThrow(/unsupported token/)
  })

  it('pays in USDT0 on Arbitrum One with its own EIP-712 domain', async () => {
    const USDT0 = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).get('PAYMENT-SIGNATURE')
        ? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
        : respond402(
            paymentRequired({
              network: 'eip155:42161',
              asset: USDT0,
              amount: '250000',
              extra: { name: 'USD₮0', version: '1' }
            })
          )
    )
    vi.stubGlobal('fetch', fetchMock)
    const cp = new ChainPe({ privateKey: TEST_KEY, network: 'arbitrum' })
    const result = await cp.pay('https://api.example.com/paid')
    expect(result.payment).toMatchObject({ amount: '0.25', token: 'USDT0' })
    const payload = decodePaymentSignatureHeader(
      new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).get('PAYMENT-SIGNATURE')!
    )
    expect(payload.accepted.asset).toBe(USDT0)
  })

  it('signs an EIP-3009 payment and retries with PAYMENT-SIGNATURE', async () => {
    const txHash = '0x' + 'ab'.repeat(32)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const sig = new Headers(init?.headers).get('PAYMENT-SIGNATURE')
      if (!sig) return respond402(paymentRequired())
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'PAYMENT-RESPONSE': encodePaymentResponseHeader({
            success: true,
            transaction: txHash,
            network: 'eip155:421614',
            payer: TEST_ADDR
          })
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const cp = new ChainPe({ privateKey: TEST_KEY, network: 'arbitrum-sepolia' })
    const result = await cp.pay<{ ok: boolean }>('https://api.example.com/paid')

    expect(result.ok).toBe(true)
    expect(result.payment).toMatchObject({
      amount: '0.01',
      token: 'USDC',
      recipient: PAY_TO,
      network: 'arbitrum-sepolia',
      txHash
    })

    const retryInit = fetchMock.mock.calls[1][1] as RequestInit
    const payload = decodePaymentSignatureHeader(
      new Headers(retryInit.headers).get('PAYMENT-SIGNATURE')!
    )
    expect(payload.x402Version).toBe(2)
    expect(payload.accepted.network).toBe('eip155:421614')
    const auth = (payload.payload as { authorization: Record<string, string> }).authorization
    expect(auth.from.toLowerCase()).toBe(TEST_ADDR.toLowerCase())
    expect(auth.to.toLowerCase()).toBe(PAY_TO)
    expect(auth.value).toBe('10000')
  })
})
