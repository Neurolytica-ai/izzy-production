/**
 * Autocomplete and derived-field resolution for the reporting grid
 * (WP §6.1 features 2 and 3, WP §5.7).
 *
 * Search semantics match the prototype's `source()` (:455-460): substring match
 * on nickname, full name or number, capped at 50 results.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.ts';
import { resolveRow } from '../lib/resolve.ts';

export const lookupRouter = Router();

const searchQuery = z.object({
  q: z.string().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * ILIKE with a user-supplied needle: escape the LIKE metacharacters so a query
 * containing % or _ searches for those literal characters instead of turning into
 * a wildcard scan.
 */
function likePattern(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

lookupRouter.get('/employees', async (req, res) => {
  const { q, limit } = searchQuery.parse(req.query);
  const includeInactive = req.query.includeInactive === 'true';

  const rows = await query(
    `SELECT num, nick, name, contractor, active, effective_target
       FROM employees
      WHERE ($3::boolean OR active)
        AND ($1 = '' OR nick ILIKE $2 OR name ILIKE $2 OR num::text LIKE $2)
      ORDER BY (nick = $1) DESC, nick
      LIMIT $4`,
    [q.trim(), likePattern(q), includeInactive, limit]
  );
  res.json({ data: rows, count: rows.length });
});

lookupRouter.get('/projects', async (req, res) => {
  const { q, limit } = searchQuery.parse(req.query);
  const rows = await query(
    `SELECT num, nick, name, client, overhead
       FROM projects
      WHERE $1 = '' OR nick ILIKE $2 OR name ILIKE $2 OR num::text LIKE $2
      ORDER BY (nick = $1) DESC, overhead, num
      LIMIT $3`,
    [q.trim(), likePattern(q), limit]
  );
  res.json({ data: rows, count: rows.length });
});

lookupRouter.get('/departments', async (req, res) => {
  const { q, limit } = searchQuery.parse(req.query);
  const rows = await query(
    `SELECT d.name, d.num, d.bucket, b.label_he AS bucket_label
       FROM departments d
       LEFT JOIN buckets b ON b.key = d.bucket
      WHERE $1 = '' OR d.name ILIKE $2 OR d.num::text LIKE $2
      ORDER BY d.num NULLS LAST, d.name
      LIMIT $3`,
    [q.trim(), likePattern(q), limit]
  );
  res.json({ data: rows, count: rows.length });
});

lookupRouter.get('/repairs', async (req, res) => {
  const { q, limit } = searchQuery.parse(req.query);
  const rows = await query(
    `SELECT fix, client, date, model
       FROM repairs
      WHERE $1 = '' OR fix::text LIKE $2 OR client ILIKE $2
      ORDER BY fix DESC
      LIMIT $3`,
    [q.trim(), likePattern(q), limit]
  );
  res.json({ data: rows, count: rows.length });
});

/**
 * WP §5.7 — resolve a typed grid row to its numeric keys and display fields.
 * Anything supplied but unmatched comes back in `unresolved`, which is what the
 * grid renders as "לא זוהה" and what blocks submission (WP §6.1).
 */
const resolveSchema = z.object({
  emp: z.union([z.string(), z.number()]).nullish(),
  proj: z.union([z.string(), z.number()]).nullish(),
  dept: z.string().nullish(),
  fix: z.union([z.string(), z.number()]).nullish(),
});

lookupRouter.post('/resolve', async (req, res) => {
  const input = resolveSchema.parse(req.body);
  const resolved = await resolveRow({
    emp: input.emp ?? null,
    proj: input.proj ?? null,
    dept: input.dept ?? null,
    fix: input.fix ?? null,
  });
  res.json({ data: resolved });
});
