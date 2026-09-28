/** The watcher: polls `getLogs` over the two contracts and writes rows. */
import { TransactionReceiptNotFoundError, type PublicClient } from 'viem'
import { REGISTRY_EVENTS, REPUTATION_EVENTS, REGISTRY_READ_ABI } from './abi.js'
import {
  serviceRowFromArgs,
  feedbackRowFromArgs,
  type ServiceEventArgs,
  type FeedbackEventArgs
} from './core.js'
import {
  upsertService,
  deactivateService,
  insertFeedback,
  revokeFeedback,
  isPaymentTxUsed,
  payToForAgent,
  getCursor,
  setCursor
} from './store.js'
import { verifyFeedback, loadFeedbackFile, type FeedbackVerdict } from './verify.js'
import type { Db } from './db.js'

const ALL_EVENTS = [...REGISTRY_EVENTS, ...REPUTATION_EVENTS]

export interface IndexerDeps {
  db: Db
  client: PublicClient
  registry: `0x${string}`
  reputation: `0x${string}`
  startBlock: bigint
  chunk: bigint
  pollIntervalMs: number
  chainId: number
  /** Stablecoins accepted as payment proof. */
  paymentTokens: string[]
  ipfsGateway: string
}

let head = 0n
/** Latest chain head observed (for /health). */
export function getIndexerHead(): bigint {
  return head
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Reads description + tags from the registry's getService view (best-effort). */
async function readServiceMeta(
  deps: IndexerDeps,
  developer: string,
  name: string
): Promise<{ description: string; tags: string } | undefined> {
  try {
    const svc = (await deps.client.readContract({
      address: deps.registry,
      abi: REGISTRY_READ_ABI,
      functionName: 'getService',
      args: [developer as `0x${string}`, name]
    })) as { description: string; tags: string; exists: boolean }
    if (!svc.exists) return undefined
    return { description: svc.description, tags: svc.tags }
  } catch {
    return undefined
  }
}

/**
 * Checks a NewFeedback's payment proof. Returns null for agents that aren't
 * ChainPe services: the Reputation Registry is shared by every agent on the
 * chain, and we only store what we rank.
 */
async function checkFeedback(
  deps: IndexerDeps,
  args: FeedbackEventArgs
): Promise<FeedbackVerdict | null> {
  const agentId = args.agentId.toString()
  const payTo = await payToForAgent(deps.db, agentId)
  if (payTo.length === 0) return null

  const verdict = await verifyFeedback(
    {
      agentId,
      client: args.clientAddress,
      feedbackURI: args.feedbackURI ?? '',
      feedbackHash: args.feedbackHash ?? ''
    },
    {
      chainId: deps.chainId,
      payTo,
      tokens: deps.paymentTokens,
      loadFile: uri => loadFeedbackFile(uri, { ipfsGateway: deps.ipfsGateway }),
      getReceipt: hash =>
        deps.client.getTransactionReceipt({ hash }).catch(err => {
          if (err instanceof TransactionReceiptNotFoundError) return undefined
          throw err // transient: the loop retries this block range
        }),
      isPaymentUsed: tx =>
        isPaymentTxUsed(deps.db, tx, {
          agentId,
          client: args.clientAddress,
          feedbackIndex: args.feedbackIndex
        })
    }
  )
  if (!verdict.verified) {
    console.log(
      `feedback agent=${agentId} client=${args.clientAddress} #${args.feedbackIndex}: unverified (${verdict.reason})`
    )
  }
  return verdict
}

/** Indexes a single (inclusive) block range. Exposed for targeted backfills. */
export async function processRange(
  deps: IndexerDeps,
  fromBlock: bigint,
  toBlock: bigint
): Promise<number> {
  const logs = await deps.client.getLogs({
    address: [deps.registry, deps.reputation],
    events: ALL_EVENTS,
    fromBlock,
    toBlock
  })

  for (const log of logs) {
    const block = log.blockNumber ?? toBlock
    switch (log.eventName) {
      case 'ServiceRegistered':
      case 'ServiceUpdated': {
        const args = log.args as unknown as ServiceEventArgs
        // Events omit description + tags — read them from the registry view.
        const extra = await readServiceMeta(deps, args.developer, args.name)
        await upsertService(deps.db, serviceRowFromArgs(args, block, extra))
        break
      }
      case 'ServiceDeregistered':
        await deactivateService(
          deps.db,
          (log.args as { key: string }).key,
          block
        )
        break
      case 'NewFeedback': {
        const args = log.args as unknown as FeedbackEventArgs
        const verdict = await checkFeedback(deps, args)
        if (verdict) await insertFeedback(deps.db, feedbackRowFromArgs(args, block, verdict))
        break
      }
      case 'FeedbackRevoked': {
        const a = log.args as {
          agentId: bigint
          clientAddress: string
          feedbackIndex: bigint
        }
        await revokeFeedback(
          deps.db,
          a.agentId.toString(),
          a.clientAddress,
          a.feedbackIndex
        )
        break
      }
    }
  }
  return logs.length
}

/** Runs the catch-up + tail-follow loop until aborted. */
export async function runIndexer(
  deps: IndexerDeps,
  opts: { signal?: AbortSignal } = {}
): Promise<void> {
  const cursor = await getCursor(deps.db)
  let last = cursor ?? (deps.startBlock > 0n ? deps.startBlock - 1n : 0n)
  let backoff = 1_000

  while (!opts.signal?.aborted) {
    try {
      head = await deps.client.getBlockNumber()
      if (last >= head) {
        backoff = 1_000
        await sleep(deps.pollIntervalMs)
        continue
      }
      const from = last + 1n
      const end = from + deps.chunk - 1n
      const to = end > head ? head : end
      await processRange(deps, from, to)
      await setCursor(deps.db, to)
      last = to
      backoff = 1_000
      if (to >= head) await sleep(deps.pollIntervalMs)
    } catch (err) {
      console.error(`indexer loop error (retrying in ${backoff}ms):`, err)
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 60_000)
    }
  }
}
