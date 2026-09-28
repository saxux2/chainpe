import pkg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

const { Pool } = pkg
export type Pool = InstanceType<typeof Pool>
export type Db = NodePgDatabase<typeof schema>

export interface DbHandle {
  pool: Pool
  db: Db
}

export function createDb(connectionString: string): DbHandle {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run the indexer.')
  }
  // Hosted Postgres (Neon, Supabase, Railway external, RDS) requires TLS, and
  // `pg` doesn't reliably enable it from the URL's sslmode. Turn it on
  // explicitly for those hosts (connection stays encrypted).
  const needsSsl = /sslmode=require|neon\.tech|supabase|amazonaws|render\.com/.test(
    connectionString
  )
  const pool = new Pool({
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {})
  })
  const db = drizzle(pool, { schema })
  return { pool, db }
}

/** Creates tables/indexes if absent (safe to run on every boot). */
export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(schema.SCHEMA_DDL)
}
