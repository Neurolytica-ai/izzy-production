/**
 * Postgres connection pool and query helpers.
 *
 * WP §3.3: the server is the single source of truth and several people report
 * hours at once, so everything that must be atomic goes through withTransaction()
 * rather than a bare sequence of queries.
 */
import pg from 'pg';
import { config } from './config.ts';

/**
 * numeric comes back from node-postgres as a string, because a 64-bit numeric
 * does not fit a JS number safely. Every hours column here is numeric(5,2) —
 * comfortably inside float64 — and the API contract says numbers, so parse them.
 * int8/bigint is deliberately left as a string; ids are opaque to the client.
 */
const NUMERIC_OID = 1700;
pg.types.setTypeParser(NUMERIC_OID, (v) => (v === null ? null : Number(v)));

/**
 * int8/bigint also arrives as a string, for the same reason: int8 spans further
 * than float64 can represent exactly. Every int8 in this schema is a
 * sequence-generated surrogate key (users.id, reports.id, activity_log.id) plus
 * the occasional count(*), so real values stay many orders of magnitude below
 * Number.MAX_SAFE_INTEGER and parsing is safe.
 *
 * This is not cosmetic. Leaving it as a string caused every valid session to be
 * rejected: the login handler signed a token with users.id, the string "3" went
 * into the JWT, and the verifier's `typeof uid === 'number'` check failed. The
 * type annotations claimed number throughout and the compiler could not see the
 * lie, because a type parameter on a query is an assertion, not a guarantee.
 */
const INT8_OID = 20;
pg.types.setTypeParser(INT8_OID, (v) => (v === null ? null : Number(v)));

/** date (not timestamptz) as a plain YYYY-MM-DD string, never a JS Date. */
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.dbSsl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // An idle client erroring is not fatal; the pool replaces it. Log so a
  // recurring pattern is visible rather than silent.
  console.error('[db] idle client error:', err.message);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Runs fn inside a transaction, rolling back on any throw. The client is passed
 * in so callers can issue several statements atomically — used by the Excel
 * import commit (WP §9.2) and anything that writes an activity-log entry
 * alongside the change it describes.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = process.hrtime.bigint();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Number(process.hrtime.bigint() - started) / 1e6 };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
