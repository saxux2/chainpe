import { describe, it, expect, vi } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, toBytes, type Log } from 'viem'
import {
  verifyFeedback,
  decodeDataUri,
  feedbackFetchUrl,
  loadFeedbackFile,
  type VerifyContext,
  type FeedbackToVerify
} from '../src/verify.js'

const CLIENT = '0x1111111111111111111111111111111111111111'
const PAY_TO = '0x2222222222222222222222222222222222222222'
const OTHER = '0x3333333333333333333333333333333333333333'
const USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
const TX = `0x${'ab'.repeat(32)}`
const CHAIN_ID = 421614

function transferLog(token: string, from: string, to: string, value: bigint): Log {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value])
  } as unknown as Log
}

function feedbackFile(overrides: Record<string, unknown> = {}, proof: Record<string, unknown> = {}) {
  return {
    agentId: 7,
    clientAddress: `eip155:${CHAIN_ID}:${CLIENT}`,
    value: 100,
    valueDecimals: 0,
    proofOfPayment: { fromAddress: CLIENT, toAddress: PAY_TO, chainId: String(CHAIN_ID), txHash: TX, ...proof },
    ...overrides
  }
}

/** The event + a context whose I/O serves `file` and a receipt with `logs`. */
function setup(
  file: unknown,
  opts: { logs?: Log[]; status?: 'success' | 'reverted'; noReceipt?: boolean; used?: boolean; hash?: string } = {}
) {
  const json = JSON.stringify(file)
  const uri = `data:application/json;base64,${Buffer.from(json).toString('base64')}`
  const fb: FeedbackToVerify = {
    agentId: '7',
    client: CLIENT,
    feedbackURI: uri,
    feedbackHash: opts.hash ?? keccak256(toBytes(json))
  }
  const ctx: VerifyContext = {
    chainId: CHAIN_ID,
    payTo: [PAY_TO],
    tokens: [USDC],
    loadFile: async u => decodeDataUri(u),
    getReceipt: vi.fn(async () =>
      opts.noReceipt
        ? undefined
        : { status: opts.status ?? 'success', logs: opts.logs ?? [transferLog(USDC, CLIENT, PAY_TO, 10_000n)] }
    ),
    isPaymentUsed: vi.fn(async () => opts.used ?? false)
  }
  return { fb, ctx }
}

describe('verifyFeedback', () => {
  it('verifies a hashed file whose payment reached the service', async () => {
    const { fb, ctx } = setup(feedbackFile())
    expect(await verifyFeedback(fb, ctx)).toEqual({ verified: true, paymentTx: TX })
  })

  it('accepts addresses in any case', async () => {
    const { fb, ctx } = setup(feedbackFile({}, { toAddress: PAY_TO.toUpperCase().replace('0X', '0x') }))
    expect((await verifyFeedback(fb, ctx)).verified).toBe(true)
  })

  it('rejects feedback without a file', async () => {
    const { fb, ctx } = setup(feedbackFile())
    const out = await verifyFeedback({ ...fb, feedbackURI: '', feedbackHash: `0x${'0'.repeat(64)}` }, ctx)
    expect(out).toMatchObject({ verified: false, reason: 'no_file' })
  })

  it('rejects a hash mismatch', async () => {
    const { fb, ctx } = setup(feedbackFile(), { hash: `0x${'11'.repeat(32)}` })
    expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'hash_mismatch' })
    expect(ctx.getReceipt).not.toHaveBeenCalled()
  })

  it('rejects a file without proofOfPayment', async () => {
    const { fb, ctx } = setup({ agentId: 7, value: 100 })
    expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'no_proof' })
  })

  it('rejects a proof paying someone other than the service', async () => {
    const { fb, ctx } = setup(feedbackFile({}, { toAddress: OTHER }))
    expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'proof_mismatch' })
  })

  it('rejects a proof from another payer, chain or agent', async () => {
    for (const file of [
      feedbackFile({}, { fromAddress: OTHER }),
      feedbackFile({}, { chainId: '42161' }),
      feedbackFile({ agentId: 8 }),
      feedbackFile({ clientAddress: `eip155:${CHAIN_ID}:${OTHER}` })
    ]) {
      const { fb, ctx } = setup(file)
      expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'proof_mismatch' })
    }
  })

  it('rejects a payment already used by another verified review', async () => {
    const { fb, ctx } = setup(feedbackFile(), { used: true })
    expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'payment_reused', paymentTx: TX })
  })

  it('rejects a missing or reverted payment tx', async () => {
    for (const opts of [{ noReceipt: true }, { status: 'reverted' as const }]) {
      const { fb, ctx } = setup(feedbackFile(), opts)
      expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'payment_not_found' })
    }
  })

  it('rejects a tx whose transfer went to the wrong address', async () => {
    const { fb, ctx } = setup(feedbackFile(), { logs: [transferLog(USDC, CLIENT, OTHER, 10_000n)] })
    expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'no_matching_transfer' })
  })

  it('rejects transfers of an unsupported token, from someone else, or of zero', async () => {
    for (const log of [
      transferLog(OTHER, CLIENT, PAY_TO, 10_000n),
      transferLog(USDC, OTHER, PAY_TO, 10_000n),
      transferLog(USDC, CLIENT, PAY_TO, 0n)
    ]) {
      const { fb, ctx } = setup(feedbackFile(), { logs: [log] })
      expect(await verifyFeedback(fb, ctx)).toMatchObject({ verified: false, reason: 'no_matching_transfer' })
    }
  })

  it('lets transient receipt errors propagate so the range is retried', async () => {
    const { fb, ctx } = setup(feedbackFile())
    ctx.getReceipt = async () => {
      throw new Error('429 Too Many Requests')
    }
    await expect(verifyFeedback(fb, ctx)).rejects.toThrow('429')
  })
})

describe('feedback file loading', () => {
  it('decodes base64 and percent-encoded data: URIs', () => {
    const text = '{"a":1}'
    expect(new TextDecoder().decode(decodeDataUri(`data:application/json;base64,${btoa(text)}`))).toBe(text)
    expect(new TextDecoder().decode(decodeDataUri(`data:application/json,${encodeURIComponent(text)}`))).toBe(text)
    expect(decodeDataUri('not-a-data-uri')).toBeUndefined()
  })

  it('maps ipfs:// through the gateway and refuses non-public URLs', () => {
    const gw = 'https://ipfs.io/ipfs'
    expect(feedbackFetchUrl('ipfs://bafyabc', gw)).toBe('https://ipfs.io/ipfs/bafyabc')
    expect(feedbackFetchUrl('ipfs://ipfs/bafyabc', gw)).toBe('https://ipfs.io/ipfs/bafyabc')
    expect(feedbackFetchUrl('https://files.example.com/fb.json', gw)).toBe('https://files.example.com/fb.json')
    for (const bad of [
      'http://files.example.com/fb.json',
      'https://localhost/fb.json',
      'https://127.0.0.1/fb.json',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/fb.json',
      'https://192.168.1.1/fb.json',
      'https://[::1]/fb.json',
      'file:///etc/passwd'
    ]) {
      expect(feedbackFetchUrl(bad, gw)).toBeUndefined()
    }
  })

  it('refuses oversized remote files', async () => {
    const big = new Uint8Array(70 * 1024)
    const fetchImpl = vi.fn(async () => new Response(big)) as unknown as typeof fetch
    expect(await loadFeedbackFile('https://files.example.com/fb.json', { ipfsGateway: '', fetchImpl })).toBeUndefined()
  })

  it('returns undefined when the remote fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('timeout')
    }) as unknown as typeof fetch
    expect(await loadFeedbackFile('https://files.example.com/fb.json', { ipfsGateway: '', fetchImpl })).toBeUndefined()
  })
})
