import {
  pgTable,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  serial,
  uniqueIndex
} from 'drizzle-orm/pg-core'

export const services = pgTable('services', {
  key: text('key').primaryKey(),
  developer: text('developer').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  tags: text('tags').notNull().default(''),
  endpoint: text('endpoint').notNull(),
  pricePerRequest: text('price_per_request').notNull(),
  paymentToken: text('payment_token').notNull(),
  payTo: text('pay_to').notNull(),
  agentId: text('agent_id'),
  active: boolean('active').notNull().default(true),
  updatedBlock: bigint('updated_block', { mode: 'bigint' }).notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

export const feedback = pgTable(
  'feedback',
  {
    id: serial('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    client: text('client').notNull(),
    feedbackIndex: bigint('feedback_index', { mode: 'bigint' }).notNull(),
    value: integer('value').notNull(),
    valueDecimals: integer('value_decimals').notNull(),
    tag1: text('tag1'),
    tag2: text('tag2'),
    revoked: boolean('revoked').notNull().default(false),
    verified: boolean('verified').notNull().default(false),
    paymentTx: text('payment_tx'),
    block: bigint('block', { mode: 'bigint' }).notNull()
  },
  t => ({
    uniq: uniqueIndex('feedback_agent_client_index').on(
      t.agentId,
      t.client,
      t.feedbackIndex
    )
  })
)

export const indexerState = pgTable('indexer_state', {
  id: integer('id').primaryKey(),
  lastBlock: bigint('last_block', { mode: 'bigint' }).notNull()
})

/** Idempotent DDL run on boot (avoids shipping a separate migration tool). */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS services (
  key TEXT PRIMARY KEY,
  developer TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL,
  price_per_request TEXT NOT NULL,
  payment_token TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  agent_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_block BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  client TEXT NOT NULL,
  feedback_index BIGINT NOT NULL,
  value INTEGER NOT NULL,
  value_decimals INTEGER NOT NULL,
  tag1 TEXT,
  tag2 TEXT,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  block BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS feedback_agent_client_index
  ON feedback (agent_id, client, feedback_index);
CREATE INDEX IF NOT EXISTS feedback_agent_id ON feedback (agent_id);
-- Payment-proof columns (added for verified reputation; older rows stay unverified).
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS payment_tx TEXT;
CREATE INDEX IF NOT EXISTS feedback_payment_tx ON feedback (payment_tx) WHERE verified;
CREATE INDEX IF NOT EXISTS services_agent_id ON services (agent_id);
CREATE TABLE IF NOT EXISTS indexer_state (
  id INTEGER PRIMARY KEY,
  last_block BIGINT NOT NULL
);
`
