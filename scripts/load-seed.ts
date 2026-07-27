/**
 * Loads db/seed/seed.json into the database named by DATABASE_URL.
 *
 *   npm run seed:load                  master data + reports (reports only if empty)
 *   npm run seed:load -- --master-only  skip reports entirely
 *
 * Master data upserts, so this is safe to re-run. Reports are inserted only when
 * the table is empty — re-running would otherwise duplicate history.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';
import { loadSeed, type SeedFile, type Queryable } from './lib/seed-loader.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_JSON = path.join(HERE, '..', 'db', 'seed', 'seed.json');

async function main() {
  const masterOnly = process.argv.includes('--master-only');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const seed = JSON.parse(await readFile(SEED_JSON, 'utf8')) as SeedFile;

  if (seed._meta?.notes?.length) {
    console.log('Seed file recorded these anomalies at extraction time:');
    for (const n of seed._meta.notes) console.log(n.startsWith(' ') ? n : `  • ${n}`);
    console.log('');
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  const q: Queryable = { query: (sql, params) => client.query(sql, params) };

  try {
    // One transaction: a partial seed is worse than no seed.
    await client.query('BEGIN');
    const result = await loadSeed(q, seed, { includeReports: !masterOnly });
    await client.query('COMMIT');

    console.log('Loaded:');
    console.table(result);

    const orphans = await client.query<{ missing_proj_num: number; box_count: number }>(
      'SELECT * FROM v_orphan_standard_parents'
    );
    if (orphans.rows.length) {
      const boxes = orphans.rows.reduce((s, o) => s + o.box_count, 0);
      console.log(
        `\nWARNING: ${orphans.rows.length} parent project(s) referenced by ${boxes} box row(s) do not exist.\n` +
          `Those boxes will not appear in budget-vs-actual. Inspect with:\n` +
          `  SELECT * FROM v_orphan_standard_parents;`
      );
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nseed:load failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
