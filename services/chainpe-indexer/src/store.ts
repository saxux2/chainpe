/** Database operations (writes from the indexer, reads for the API). */
import { and, eq, inArray, not, sql } from 'drizzle-orm'
import type { Db } from './db.js'
import { services, feedback, indexerState } from './schema.js'
import type { ServiceRow, FeedbackRow } from './core.js'

export async function upsertService(db: Db, row: ServiceRow): Promise<void> {
  await db
    .insert(services)
    .values({
      key: row.key,
      developer: row.developer,
      name: row.name,
      description: row.description,
      tags: row.tags,
      endpoint: row.endpoint,
      pricePerRequest: row.pricePerRequest,
      paymentToken: row.paymentToken,
      payTo: row.payTo,
      agentId: row.agentId,
      active: true,
      updatedBlock: row.updatedBlock,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: services.key,
      set: {
        developer: row.developer,
        name: row.name,
        description: row.description,
        tags: row.tags,
        endpoint: row.endpoint,
        pricePerRequest: row.pricePerRequest,
        paymentToken: row.paymentToken,
        payTo: row.payTo,
        agentId: row.agentId,
        active: true,
        updatedBlock: row.updatedBlock,
        updatedAt: new Date()
      }
    })
}

export async function deactivateService(
  db: Db,
  key: string,
  block: bigint
): Promise<void> {
  await db
    .update(services)
    .set({ active: false, updatedBlock: block, updatedAt: new Date() })
    .where(eq(services.key, key))
}

export async function insertFeedback(db: Db, row: FeedbackRow): Promise<void> {
  await db
    .insert(feedback)
    .values({
      agentId: row.agentId,
      client: row.client,
      feedbackIndex: row.feedbackIndex,
      value: row.value,
      valueDecimals: row.valueDecimals,
      tag1: row.tag1,
      tag2: row.tag2,
      revoked: false,
      verified: row.verified,
      paymentTx: row.paymentTx,
      block: row.block
    })
    .onConflictDoNothing()
}

/**
 * True when a verified feedback other than (agentId, client, feedbackIndex)
 * already cites `paymentTx` — one payment backs one review.
 */
export async function isPaymentTxUsed(
  db: Db,
  paymentTx: string,
  except: { agentId: string; client: string; feedbackIndex: bigint }
): Promise<boolean> {
  const rows = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(
      and(
        eq(feedback.paymentTx, paymentTx.toLowerCase()),
        eq(feedback.verified, true),
        not(
          and(
            eq(feedback.agentId, except.agentId),
            eq(feedback.client, except.client),
            eq(feedback.feedbackIndex, except.feedbackIndex)
          )!
        )
      )
    )
    .limit(1)
  return rows.length > 0
}

/** Pay-to addresses of the ChainPe services linked to `agentId` (empty ⇒ not ours). */
export async function payToForAgent(db: Db, agentId: string): Promise<string[]> {
  const rows = await db
    .select({ payTo: services.payTo })
    .from(services)
    .where(eq(services.agentId, agentId))
  return [...new Set(rows.map(r => r.payTo))]
}

export async function revokeFeedback(
  db: Db,
  agentId: string,
  client: string,
  feedbackIndex: bigint
): Promise<void> {
  await db
    .update(feedback)
    .set({ revoked: true })
    .where(
      and(
        eq(feedback.agentId, agentId),
        eq(feedback.client, client),
        eq(feedback.feedbackIndex, feedbackIndex)
      )
    )
}

export async function getCursor(db: Db): Promise<bigint | null> {
  const rows = await db
    .select()
    .from(indexerState)
    .where(eq(indexerState.id, 1))
  return rows[0]?.lastBlock ?? null
}

export async function setCursor(db: Db, lastBlock: bigint): Promise<void> {
  await db
    .insert(indexerState)
    .values({ id: 1, lastBlock })
    .onConflictDoUpdate({ target: indexerState.id, set: { lastBlock } })
}

// ─── Reads for the API ───────────────────────────────────────────────────────

export type ServiceRecord = typeof services.$inferSelect
export type FeedbackRecord = typeof feedback.$inferSelect

export async function listActiveServices(db: Db): Promise<ServiceRecord[]> {
  return db.select().from(services).where(eq(services.active, true))
}

export async function getServiceByKey(
  db: Db,
  key: string
): Promise<ServiceRecord | undefined> {
  const rows = await db.select().from(services).where(eq(services.key, key))
  return rows[0]
}

export async function getFeedbackForAgents(
  db: Db,
  agentIds: string[]
): Promise<FeedbackRecord[]> {
  if (agentIds.length === 0) return []
  return db.select().from(feedback).where(inArray(feedback.agentId, agentIds))
}

export async function counts(
  db: Db
): Promise<{ services: number; feedback: number }> {
  const [s] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(services)
    .where(eq(services.active, true))
  const [f] = await db.select({ n: sql<number>`count(*)::int` }).from(feedback)
  return { services: s?.n ?? 0, feedback: f?.n ?? 0 }
}
