/**
 * Activity log — the audit trail (WP §6.7, §7.3).
 *
 * Pulled forward from Phase 4 at the client's request (feedback 2026-08-03 #8:
 * "the action log needs to be active already at this stage"). The entries have
 * been written since Phase 1 — every data-changing route logs inside its own
 * transaction (lib/activity.ts); this route only reads them out.
 *
 * Viewing requires any signed-in user: WP §8's role table forbids reporters
 * only from *clearing* the log, and the detail lines carry nothing sensitive by
 * construction (names and numbers, never credentials — see lib/activity.ts).
 * Clearing is admin-only and is itself logged, per the §6.7 acceptance criteria.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../lib/db.ts';
import { ACTION, logWith } from '../lib/activity.ts';
import { currentUser, requireRole } from '../middleware/auth.ts';
import { t } from '../lib/messages.ts';

export const activityRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('field.dateFormat'));

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** One of the ACTION codes — the client gets the list from /api/meta/vocabulary. */
  action: z.string().max(40).optional(),
  /** Free text across the detail line and the acting user's name. */
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

activityRouter.get('/activity-log', async (req, res) => {
  const q = listQuery.parse(req.query);

  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  if (q.from) add('a.ts >= ?::date', q.from);
  if (q.to) add(`a.ts < ?::date + interval '1 day'`, q.to);
  if (q.action) add('a.action = ?', q.action);
  if (q.q) {
    const needle = `%${q.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    values.push(needle);
    const p = `$${values.length}`;
    where.push(`(a.detail ILIKE ${p} OR u.display_name ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const fromSql = `FROM activity_log a LEFT JOIN users u ON u.id = a.user_id ${whereSql}`;

  const [rows, totals] = await Promise.all([
    query(
      `SELECT a.id, a.ts, a.user_id, u.display_name AS user_name,
              a.action, a.detail, a.entity, a.entity_key
         ${fromSql}
        ORDER BY a.ts DESC, a.id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, q.limit, q.offset]
    ),
    queryOne<{ total_rows: number }>(`SELECT count(*)::int AS total_rows ${fromSql}`, values),
  ]);

  res.json({
    data: rows,
    count: rows.length,
    meta: {
      totalRows: totals?.total_rows ?? 0,
      limit: q.limit,
      offset: q.offset,
      hasMore: q.offset + rows.length < (totals?.total_rows ?? 0),
    },
  });
});

activityRouter.delete('/activity-log', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  await withTransaction(async (client) => {
    const del = await client.query('DELETE FROM activity_log');
    // WP §6.7: "clearing is itself logged" — inside the same transaction, so the
    // log is never empty without a line saying who emptied it.
    await logWith(client, {
      userId: user.id,
      action: ACTION.logCleared,
      detail: `${del.rowCount ?? 0} entries removed`,
    });
  });
  res.status(204).end();
});
