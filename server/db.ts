/**
 * Database access. Production runs on Supabase (Postgres) via DATABASE_URL.
 * Without DATABASE_URL, an embedded Postgres (PGlite) is used for local development and tests,
 * so the same SQL runs everywhere.
 *
 * Queries are written with `?` placeholders and converted to Postgres `$n` parameters.
 * Every query inside `tx()` runs on the transaction's own connection.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

type Row = Record<string, any>;
type P = string | number | null | boolean;
interface Exec { query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number }> }
interface Driver { base: Exec; transaction<T>(fn: (e: Exec) => Promise<T>): Promise<T>; /** Several statements in one round trip. */ script(sql: string): Promise<void> }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass_hash TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'JPY', monthly_budget_minor BIGINT, alert_threshold INTEGER NOT NULL DEFAULT 80,
  last_reviewed_at TEXT COLLATE "C" NOT NULL, av_key_enc TEXT, anthropic_key_enc TEXT, ingest_token_hash TEXT, created_at TEXT COLLATE "C" NOT NULL,
  onboarded_at TEXT COLLATE "C"
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at TEXT COLLATE "C";
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT COLLATE "C" NOT NULL, created_at TEXT COLLATE "C" NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, bank TEXT, name TEXT NOT NULL, card_type TEXT, last4 TEXT, currency TEXT NOT NULL,
  balance_minor BIGINT, balance_as_of TEXT COLLATE "C", balance_source TEXT, balance_updated_at TEXT COLLATE "C",
  theme TEXT NOT NULL DEFAULT 'graphite', archived INTEGER NOT NULL DEFAULT 0, created_at TEXT COLLATE "C" NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'dots', slot INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'expense', budget_minor BIGINT, UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS merchant_rules (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_key TEXT NOT NULL, merchant TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL, UNIQUE(user_id, merchant_key)
);
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  transfer_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  type TEXT NOT NULL, amount_minor BIGINT NOT NULL, currency TEXT NOT NULL,
  date TEXT COLLATE "C" NOT NULL, time TEXT COLLATE "C", tz TEXT, date_inferred INTEGER NOT NULL DEFAULT 0,
  merchant TEXT NOT NULL, merchant_key TEXT NOT NULL, raw_descriptor TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, subcategory TEXT,
  payment_method TEXT, note TEXT, source TEXT NOT NULL, sms_hash TEXT, fingerprint TEXT NOT NULL, raw_sms TEXT,
  income_payment_id INTEGER, needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT COLLATE "C" NOT NULL, updated_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS txn_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS txn_user_fp ON transactions(user_id, fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS txn_user_sms ON transactions(user_id, sms_hash) WHERE sms_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS seen_sms (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, sms_hash TEXT NOT NULL,
  class TEXT NOT NULL, created_at TEXT COLLATE "C" NOT NULL, PRIMARY KEY(user_id, sms_hash)
);
CREATE TABLE IF NOT EXISTS fx_rates (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, from_ccy TEXT NOT NULL, to_ccy TEXT NOT NULL,
  rate DOUBLE PRECISION NOT NULL, updated_at TEXT COLLATE "C" NOT NULL, PRIMARY KEY(user_id, from_ccy, to_ccy)
);
CREATE TABLE IF NOT EXISTS income_sources (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, recurrence TEXT NOT NULL DEFAULT 'none',
  amount_minor BIGINT, notes TEXT, created_at TEXT COLLATE "C" NOT NULL
);
CREATE TABLE IF NOT EXISTS income_payments (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  expected_date TEXT COLLATE "C", expected_minor BIGINT NOT NULL DEFAULT 0,
  received_minor BIGINT NOT NULL DEFAULT 0, received_date TEXT COLLATE "C", note TEXT, updated_at TEXT COLLATE "C" NOT NULL
);
CREATE TABLE IF NOT EXISTS holdings (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, name TEXT NOT NULL, quantity DOUBLE PRECISION NOT NULL, avg_price DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL, created_at TEXT COLLATE "C" NOT NULL, UNIQUE(user_id, symbol)
);
CREATE TABLE IF NOT EXISTS market_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT COLLATE "C" NOT NULL);
CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key ON rate_hits(key, at);
CREATE INDEX IF NOT EXISTS accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS income_sources_user ON income_sources(user_id);
CREATE INDEX IF NOT EXISTS income_payments_user ON income_payments(user_id);
CREATE INDEX IF NOT EXISTS income_payments_source ON income_payments(source_id);
CREATE INDEX IF NOT EXISTS merchant_rules_category ON merchant_rules(category_id);
CREATE INDEX IF NOT EXISTS txn_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS txn_transfer_account ON transactions(transfer_account_id);
CREATE INDEX IF NOT EXISTS txn_category ON transactions(category_id);
`;
/**
 * Detects whether the newest schema change is already in place (one query on a warm database).
 * When adding to SCHEMA, write the change idempotently and point this check at it.
 */
const SCHEMA_CHECK = "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.users') AND attname = 'onboarded_at' AND NOT attisdropped) AS t";
const TABLES = ["users", "sessions", "accounts", "categories", "merchant_rules", "transactions", "seen_sms", "fx_rates", "income_sources", "income_payments", "holdings", "market_cache", "rate_hits"];
/**
 * Supabase exposes the public schema through its Data API. Row-level security with no policies
 * blocks that API entirely; the app connects as the table owner, which RLS does not restrict.
 */
const LOCKDOWN = TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join("\n");

async function postgresDriver(url: string): Promise<Driver> {
  const pg = (await import("pg")).default;
  // BIGINT and NUMERIC (e.g. SUM, COUNT) arrive as strings by default; amounts here fit in a double.
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const ca = process.env.DATABASE_CA?.replace(/\\n/g, "\n");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    // Supabase requires TLS. With DATABASE_CA set (Supabase dashboard → Database → SSL), the server
    // certificate is verified; without it the connection is still encrypted but not verified.
    ssl: local ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
  const wrap = (c: { query: (s: string, p: unknown[]) => Promise<any> }): Exec => ({
    query: async (s, p) => { const r = await c.query(s, p); return { rows: r.rows, rowCount: r.rowCount ?? 0 }; },
  });
  return {
    base: wrap(pool),
    // A parameterless query uses the simple protocol, which accepts many statements at once.
    script: async (sql) => { await pool.query(sql); },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally { client.release(); }
    },
  };
}

async function pgliteDriver(): Promise<Driver> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const file = process.env.FOLIO_DB;
  const dir = file === ":memory:" ? undefined : path.resolve(file ?? "data/pglite");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir, { parsers: { [types.INT8]: (v: string) => Number(v), [types.NUMERIC]: (v: string) => Number(v) } });
  const wrap = (c: { query: (s: string, p: unknown[]) => Promise<any> }): Exec => ({
    query: async (s, p) => { const r = await c.query(s, p); return { rows: r.rows, rowCount: r.affectedRows ?? 0 }; },
  });
  return { base: wrap(db), transaction: (fn) => db.transaction((t) => fn(wrap(t))), script: async (sql) => { await db.exec(sql); } };
}

/** A deployment configuration problem, reported to the browser in plain words (never with secrets). */
export class ConfigError extends Error {}

/** Turns a connection failure into an actionable message without echoing the connection string. */
export function explainDbError(e: any): string {
  const code = e?.code, msg = String(e?.message ?? "");
  if (e instanceof ConfigError) return msg;
  if (code === "ERR_INVALID_URL" || /invalid url/i.test(msg)) return "DATABASE_URL is not a valid URL. Check for a leftover [YOUR-PASSWORD] or square brackets, and percent-encode special characters in the password (or reset it to letters and digits).";
  if (code === "28P01" || /password authentication failed/i.test(msg)) return "The database rejected the password in DATABASE_URL. Reset it in Supabase → Project Settings → Database and update the variable.";
  if (/tenant or user not found/i.test(msg)) return "Supabase did not recognise the user in DATABASE_URL. It must be postgres.<project-ref>, as shown in the Transaction pooler string.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "The database host in DATABASE_URL could not be found. Copy the Transaction pooler string again from Supabase → Connect.";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /timeout/i.test(msg)) return "Could not reach the database. Use the Transaction pooler string (host …pooler.supabase.com, port 6543), not the direct db.… host.";
  if (/certificate|self.signed|SSL/i.test(msg)) return "The database TLS check failed. Remove DATABASE_CA or paste the full certificate from Supabase.";
  return `Could not connect to the database (${code ?? "unknown error"}).`;
}

async function init(): Promise<Driver> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url && process.env.VERCEL) throw new ConfigError("DATABASE_URL is not set. Add your Supabase Transaction pooler string in Vercel → Project → Settings → Environment Variables, then redeploy.");
  if (url && /\[YOUR-PASSWORD\]/i.test(url)) throw new ConfigError("DATABASE_URL still contains [YOUR-PASSWORD]. Replace it, including the brackets, with your database password.");
  const d = url ? await postgresDriver(url) : await pgliteDriver();
  // One round trip on a warm database: skip setup when the newest schema change is present.
  const present = (await d.base.query(SCHEMA_CHECK, [])).rows[0]?.t;
  if (!present) {
    // A second round trip only on first setup; the advisory lock serialises instances starting together.
    await d.script(`BEGIN;\nSELECT pg_advisory_xact_lock(727274);\n${SCHEMA}\n${LOCKDOWN}\nCOMMIT;`);
  }
  return d;
}

let driver: Promise<Driver> | null = null;
/** Connects and creates the schema once per process. */
export const ready = () => (driver ??= init().catch((e) => { driver = null; throw e; }));

const store = new AsyncLocalStorage<Exec>();
const placeholders = new Map<string, string>();
function toPg(sql: string) {
  let out = placeholders.get(sql);
  if (!out) {
    let i = 0;
    out = sql.replace(/\?/g, () => `$${++i}`);
    placeholders.set(sql, out);
  }
  return out;
}
async function exec(sql: string, params: P[]) {
  const e = store.getStore() ?? (await ready()).base;
  return e.query(toPg(sql), params);
}

export const all = async <T = any>(sql: string, ...p: P[]) => (await exec(sql, p)).rows as T[];
export const get = async <T = any>(sql: string, ...p: P[]) => (await exec(sql, p)).rows[0] as T | undefined;
export const run = async (sql: string, ...p: P[]) => ({ changes: (await exec(sql, p)).rowCount });
/** INSERT … and return the new row's id. */
export const insert = async (sql: string, ...p: P[]) => Number((await exec(`${sql} RETURNING id`, p)).rows[0].id);
export const now = () => new Date().toISOString();
/** Run `fn` in a transaction; every query inside it uses the transaction's connection. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (store.getStore()) return fn();
  return (await ready()).transaction((e) => store.run(e, fn));
}
