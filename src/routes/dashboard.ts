/**
 * Dashboard aggregates (WP §6.4, §7.3) — one endpoint, one round trip.
 *
 * All the arithmetic lives in the database functions deployed with the schema
 * (fn_dashboard_kpis / fn_budget_vs_actual / fn_bucket_hours, WP §5.3-§5.4),
 * already exercised read-only by verify:live. This route only resolves the
 * period selection into a from/to date range and fans out to the three.
 *
 * Period semantics follow the prototype (dashRows, :566-572):
 *   day   — exactly the given date;
 *   month — the given yyyy-mm;
 *   week  — the 7 days ending at the LAST date with any report, not at
 *           "today": the office wants the last active week even when looking
 *           on a quiet Sunday;
 *   all   — no date filter.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.ts';
import { t } from '../lib/messages.ts';

export const dashboardRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('field.dateFormat'));

const dashQuery = z
  .object({
    period: z.enum(['day', 'week', 'month', 'all']).default('all'),
    date: isoDate.optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    client: z.string().max(150).optional(),
  })
  .refine((q) => q.period !== 'day' || q.date, { message: t('field.dateFormat'), path: ['date'] })
  .refine((q) => q.period !== 'month' || q.month, { message: t('field.dateFormat'), path: ['month'] });

async function resolveRange(q: {
  period: 'day' | 'week' | 'month' | 'all';
  date?: string | undefined;
  month?: string | undefined;
}): Promise<{ from: string | null; to: string | null }> {
  switch (q.period) {
    case 'day':
      return { from: q.date!, to: q.date! };
    case 'month': {
      const from = `${q.month}-01`;
      const to = await queryOne<{ d: string }>(
        `SELECT (($1 || '-01')::date + interval '1 month' - interval '1 day')::date AS d`,
        [q.month]
      );
      return { from, to: to!.d };
    }
    case 'week': {
      const last = await queryOne<{ d: string | null }>('SELECT max(date)::date AS d FROM reports');
      if (!last?.d) return { from: null, to: null };
      const from = await queryOne<{ d: string }>(`SELECT ($1::date - 6)::date AS d`, [last.d]);
      return { from: from!.d, to: last.d };
    }
    case 'all':
      return { from: null, to: null };
  }
}

dashboardRouter.get('/dashboard', async (req, res) => {
  const q = dashQuery.parse(req.query);
  const range = await resolveRange(q);
  const client = q.client ?? null;

  const [kpis, budget, buckets, clients] = await Promise.all([
    queryOne('SELECT * FROM fn_dashboard_kpis($1, $2, $3)', [range.from, range.to, client]),
    query('SELECT * FROM fn_budget_vs_actual($1, $2, $3)', [range.from, range.to, client]),
    query('SELECT * FROM fn_bucket_hours($1, $2, $3)', [range.from, range.to, client]),
    // The customer filter's option list (prototype fillClientFilter, :573).
    query<{ client: string }>(
      `SELECT DISTINCT client FROM projects WHERE NOT overhead AND client <> '' ORDER BY client`
    ),
  ]);

  res.json({
    data: {
      period: { ...range, kind: q.period },
      kpis,
      budget,
      buckets,
      clients: clients.map((c) => c.client),
    },
  });
});
