/**
 * Migration runner.
 *
 * Applies db/migrations/*.sql in filename order, once each, tracked in a
 * schema_migrations table. Each file runs inside its own transaction, so a
 * failure leaves the database on the last good migration rather than half-way
 * through a broken one.
 *
 *   npm run migrate              apply pending migrations
 *   npm run migrate -- --status  list applied/pending and exit
 *
 * Files in db/post-seed/ are deliberately NOT picked up here — see that
 * directory's SQL header for why.
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, '..', 'db', 'migrations');

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

async function listMigrations(): Promise<{ filename: string; sql: string; checksum: string }[]> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const out = [];
  for (const filename of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
    out.push({ filename, sql, checksum: sha256(sql) });
  }
  return out;
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    // Supabase's pooler presents a cert chain node does not trust by default.
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    await client.query(TRACKING_TABLE);
    const applied = new Map<string, string>(
      (await client.query<{ filename: string; checksum: string }>(
        'SELECT filename, checksum FROM schema_migrations'
      )).rows.map((r) => [r.filename, r.checksum])
    );

    const migrations = await listMigrations();

    if (statusOnly) {
      for (const m of migrations) {
        const was = applied.get(m.filename);
        const state = !was ? 'PENDING' : was === m.checksum ? 'applied' : 'CHANGED SINCE APPLIED';
        console.log(`${state.padEnd(22)} ${m.filename}`);
      }
      return;
    }

    let ran = 0;
    for (const m of migrations) {
      const was = applied.get(m.filename);

      if (was && was !== m.checksum) {
        // Editing an applied migration means two environments now disagree about
        // what the schema is. Refuse rather than paper over it.
        throw new Error(
          `${m.filename} has changed since it was applied (${was} -> ${m.checksum}). ` +
            `Add a new migration instead of editing an applied one.`
        );
      }
      if (was) continue;

      process.stdout.write(`applying ${m.filename} ... `);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          m.filename,
          m.checksum,
        ]);
        await client.query('COMMIT');
        console.log('ok');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }

    console.log(ran === 0 ? 'Nothing to do — schema is up to date.' : `Applied ${ran} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
