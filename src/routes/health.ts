/**
 * Health and readiness. /api/health is the "is the app up" check WP §10.4 wants
 * for uptime monitoring; /api/ready also proves the database is reachable, which
 * is the useful one after a deploy.
 */
import { Router } from 'express';
import { healthCheck, queryOne } from '../lib/db.ts';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

healthRouter.get('/ready', async (_req, res) => {
  const db = await healthCheck();
  if (!db.ok) {
    res.status(503).json({ ok: false, database: db });
    return;
  }

  const migration = await queryOne<{ filename: string; applied_at: string }>(
    `SELECT filename, applied_at FROM schema_migrations ORDER BY filename DESC LIMIT 1`
  ).catch(() => null);

  res.json({
    ok: true,
    database: { ok: true, latencyMs: Math.round(db.latencyMs * 10) / 10 },
    schema: migration
      ? { latestMigration: migration.filename, appliedAt: migration.applied_at }
      : { latestMigration: null, note: 'no migrations applied yet — run npm run migrate' },
  });
});
