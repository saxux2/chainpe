/**
 * Payment-proof checks for ERC-8004 feedback. A feedback counts towards a
 * ChainPe score only if its off-chain file (a) hashes to the on-chain
 * `feedbackHash`, (b) carries a `proofOfPayment` from the reviewer to the
 * service on this chain, and (c) that tx moved a supported stablecoin from the
 * reviewer to the service. One payment backs at most one verified feedback.
 *
 * I/O (fetching the file, loading the receipt, the reuse lookup) is injected,
 * so everything here is unit-testable.
 */
import { keccak256, parseEventLogs, erc20Abi, isHex, type Log } from 'viem'

const ZERO_HASH = `0x${'0'.repeat(64)}`
/** Feedback files are small JSON documents; anything larger is refused. */
export const MAX_FEEDBACK_FILE_BYTES = 64 * 1024

export type UnverifiedReason =
  | 'no_file'
  | 'file_unavailable'
  | 'hash_mismatch'
  | 'invalid_file'
  | 'no_proof'
  | 'proof_mismatch'
  | 'payment_reused'
  | 'payment_not_found'
  | 'no_matching_transfer'

export type FeedbackVerdict =
  | { verified: true; paymentTx: string }
  | { verified: false; paymentTx: string | null; reason: UnverifiedReason }

export interface FeedbackToVerify {
  agentId: string
  /** Reviewer (`clientAddress` from the event). */
  client: string
  feedbackURI: string
  feedbackHash: string
}

export interface VerifyContext {
  chainId: number
  /** Addresses that receive payment for this agent's ChainPe services. */
  payTo: string[]
  /** Accepted stablecoin contracts. */
  tokens: string[]
  /** Returns the file's raw bytes, or undefined when it can't be loaded. */
  loadFile(uri: string): Promise<Uint8Array | undefined>
  /**
   * Returns the tx receipt, or undefined when the tx doesn't exist. Throw on
   * transient RPC errors so the caller retries instead of storing a verdict.
   */
  getReceipt(txHash: `0x${string}`): Promise<{ status: 'success' | 'reverted'; logs: Log[] } | undefined>
  /** True when another verified feedback already used this payment. */
  isPaymentUsed(txHash: string): Promise<boolean>
}

const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/** Strips an optional CAIP-10 prefix (`eip155:<chainId>:0x…`). */
function bareAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.split(':').pop()
}

export async function verifyFeedback(
  fb: FeedbackToVerify,
  ctx: VerifyContext
): Promise<FeedbackVerdict> {
  const fail = (reason: UnverifiedReason, paymentTx: string | null = null): FeedbackVerdict => ({
    verified: false,
    paymentTx,
    reason
  })

  if (!fb.feedbackURI || !fb.feedbackHash || fb.feedbackHash === ZERO_HASH) return fail('no_file')

  const bytes = await ctx.loadFile(fb.feedbackURI).catch(() => undefined)
  if (!bytes) return fail('file_unavailable')
  if (keccak256(bytes).toLowerCase() !== fb.feedbackHash.toLowerCase()) return fail('hash_mismatch')

  let file: Record<string, unknown>
  try {
    file = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!file || typeof file !== 'object' || Array.isArray(file)) return fail('invalid_file')
  } catch {
    return fail('invalid_file')
  }

  const proof = file.proofOfPayment as Record<string, unknown> | undefined
  if (!proof || typeof proof !== 'object') return fail('no_proof')
  const txHash = typeof proof.txHash === 'string' ? proof.txHash.toLowerCase() : ''
  if (!isHex(txHash) || txHash.length !== 66) return fail('no_proof')

  const payTo = ctx.payTo.find(p => same(proof.toAddress, p))
  if (
    String(proof.chainId) !== String(ctx.chainId) ||
    !same(proof.fromAddress, fb.client) ||
    !payTo ||
    (file.agentId !== undefined && String(file.agentId) !== fb.agentId) ||
    (file.clientAddress !== undefined && !same(bareAddress(file.clientAddress), fb.client))
  ) {
    return fail('proof_mismatch', txHash)
  }

  if (await ctx.isPaymentUsed(txHash)) return fail('payment_reused', txHash)

  const receipt = await ctx.getReceipt(txHash as `0x${string}`)
  if (!receipt || receipt.status !== 'success') return fail('payment_not_found', txHash)

  const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs, strict: true })
  const paid = transfers.some(
    t =>
      ctx.tokens.some(token => same(t.address, token)) &&
      same(t.args.from, fb.client) &&
      same(t.args.to, payTo) &&
      t.args.value > 0n
  )
  if (!paid) return fail('no_matching_transfer', txHash)

  return { verified: true, paymentTx: txHash }
}

// ─── Loading feedback files ──────────────────────────────────────────────────

/** Decodes a `data:` URI (base64 or percent-encoded). Undefined if malformed. */
export function decodeDataUri(uri: string): Uint8Array | undefined {
  const m = /^data:([^,]*),(.*)$/s.exec(uri)
  if (!m) return undefined
  try {
    const bytes = m[1].split(';').includes('base64')
      ? Uint8Array.from(Buffer.from(m[2], 'base64'))
      : new TextEncoder().encode(decodeURIComponent(m[2]))
    return bytes.length <= MAX_FEEDBACK_FILE_BYTES ? bytes : undefined
  } catch {
    return undefined
  }
}

/** Hosts an on-chain URI must never make the indexer call (blind SSRF). */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    return true
  }
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    )
  }
  // IPv6 loopback / unspecified / unique-local / link-local / v4-mapped.
  return h.includes(':') && (/^(::1?|f[cd]|fe[89ab])/.test(h) || h.startsWith('::ffff:'))
}

/**
 * Maps a feedback URI to the https URL to fetch: `ipfs://` goes through the
 * gateway; only public `https://` hosts are allowed. Undefined otherwise.
 */
export function feedbackFetchUrl(uri: string, ipfsGateway: string): string | undefined {
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '')
    return path ? `${ipfsGateway}/${path}` : undefined
  }
  try {
    const url = new URL(uri)
    if (url.protocol !== 'https:' || isPrivateHost(url.hostname)) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

/** Loads a feedback file: `data:` inline, else fetched with a timeout and size cap. */
export async function loadFeedbackFile(
  uri: string,
  opts: { ipfsGateway: string; timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<Uint8Array | undefined> {
  if (uri.startsWith('data:')) return decodeDataUri(uri)
  const url = feedbackFetchUrl(uri, opts.ipfsGateway)
  if (!url) return undefined
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000)
    })
    if (!res.ok) return undefined
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_FEEDBACK_FILE_BYTES) return undefined
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.length <= MAX_FEEDBACK_FILE_BYTES ? buf : undefined
  } catch {
    return undefined
  }
}
