/**
 * Reports — the central transactional entity (WP §7.3).
 *
 * Two things here are load-bearing:
 *
 * 1. Derived fields are resolved on the server (WP §5.7, §6.1). The client sends
 *    what the user typed — a nickname or a number — and the server decides what it
 *    means. The client can never invent a project number, and an unresolvable
 *    nickname is refused rather than stored as a dangling value.
 *
 * 2. Listing is paged in the database (WP §6.2 acceptance: "server-side
 *    paging/query … performant with tens of thousands of rows"). At 54 employees
 *    reporting daily this table grows by roughly 27,000 rows a year, so the
 *    prototype's "load everything into memory and filter in JS" does not survive
 *    contact with year two.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../lib/db.ts';
import { ACTION, ENTITY, logWith } from '../lib/activity.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { resolveRow } from '../lib/resolve.ts';
import { currentUser, requireRole } from '../middleware/auth.ts';
import { ApiError } from '../lib/errors.ts';
import { t } from '../lib/messages.ts';

export const reportsRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('field.dateFormat'));

/** Columns the read model exposes. Everything derived is resolved by the view. */
const VIEW_COLUMNS = `
  id, date, emp_num, emp_nick, emp_name, contractor, effective_target,
  proj_num, proj_nick, proj_name, client, overhead,
  fix, display_proj_name, repair_client,
  dept, dept_num, bucket, hours,
  created_by, created_by_name, created_at, updated_at
`;

/* -------------------------------------------------------------------- list */

const listQuery = z.object({
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  emp: z.coerce.number().int().positive().optional(),
  proj: z.coerce.number().int().positive().optional(),
  client: z.string().max(150).optional(),
  dept: z.string().max(80).optional(),
  /** Free-text across the display fields, matching the archive's search box. */
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z
    .enum(['date', 'emp_nick', 'emp_name', 'proj_nick', 'proj_name', 'client', 'dept', 'hours', 'fix'])
    .default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

reportsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);

  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  if (q.date) add('date = ?', q.date);
  if (q.from) add('date >= ?', q.from);
  if (q.to) add('date <= ?', q.to);
  if (q.emp) add('emp_num = ?', q.emp);
  if (q.proj) add('proj_num = ?', q.proj);
  if (q.client) add('client = ?', q.client);
  if (q.dept) add('dept = ?', q.dept);
  if (q.q) {
    // Escape LIKE metacharacters so a literal % is not a wildcard scan.
    const needle = `%${q.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    values.push(needle);
    const p = `$${values.length}`;
    where.push(
      `(emp_nick ILIKE ${p} OR emp_name ILIKE ${p} OR proj_nick ILIKE ${p}
        OR display_proj_name ILIKE ${p} OR client ILIKE ${p} OR dept ILIKE ${p}
        OR fix::text LIKE ${p})`
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // sort/dir come from a closed enum, so interpolating them is safe; the values
  // are never user-controlled strings.
  const orderSql = `ORDER BY ${q.sort} ${q.dir.toUpperCase()} NULLS LAST, id ${q.dir.toUpperCase()}`;

  const [rows, totals] = await Promise.all([
    query(
      `SELECT ${VIEW_COLUMNS} FROM v_reports_full ${whereSql} ${orderSql}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, q.limit, q.offset]
    ),
    // The archive shows totals for the filtered set, not just the page — so they
    // are computed over the whole match, in the database.
    queryOne<{ total_rows: number; total_hours: number; days: number }>(
      `SELECT count(*)::int AS total_rows,
              COALESCE(sum(hours), 0)::numeric AS total_hours,
              count(DISTINCT date)::int AS days
         FROM v_reports_full ${whereSql}`,
      values
    ),
  ]);

  res.json({
    data: rows,
    count: rows.length,
    meta: {
      totalRows: totals?.total_rows ?? 0,
      totalHours: totals?.total_hours ?? 0,
      days: totals?.days ?? 0,
      limit: q.limit,
      offset: q.offset,
      hasMore: q.offset + rows.length < (totals?.total_rows ?? 0),
    },
  });
});

/* --------------------------------------------------- resolve + over-target */

const typedValue = z.union([z.string(), z.number()]);

const createSchema = z.object({
  date: isoDate,
  emp: typedValue,
  proj: typedValue.nullish(),
  fix: typedValue.nullish(),
  dept: z.string().min(1),
  // Not constrained to 0.5 steps. WP §4.5 describes 0.5 increments and the grid
  // input uses step=0.5, but rejecting anything else server-side would make the
  // Phase 3 bulk import fail on historical rows we have not seen yet.
  // See docs/OPEN-QUESTIONS.md.
  hours: z.coerce.number().positive('Hours must be greater than zero').max(24),
  /**
   * The prototype warns when a day's total would exceed the employee's target and
   * lets the user confirm (finalizeDraft, :505). That is a real rule the work plan
   * omits. Across a network it becomes: refuse with 409 over_target, let the
   * client confirm, retry with this flag.
   */
  acknowledgeOverTarget: z.boolean().optional().default(false),
});

interface ResolvedInput {
  emp_num: number;
  proj_num: number | null;
  fix: number | null;
  dept: string;
}

async function resolveOrThrow(input: {
  emp: string | number;
  proj?: string | number | null | undefined;
  dept: string;
  fix?: string | number | null | undefined;
}): Promise<ResolvedInput> {
  const resolved = await resolveRow({
    emp: input.emp,
    proj: input.proj ?? null,
    dept: input.dept,
    fix: input.fix ?? null,
  });

  if (resolved.unresolved.length > 0) {
    // WP §6.1: an unresolved value blocks submission until corrected. Naming the
    // fields lets the grid mark exactly those cells "not identified".
    throw new ApiError(400, t('error.invalidInput'), 'unresolved', {
      unresolved: resolved.unresolved,
    });
  }
  if (!resolved.employee) throw badRequest('error.invalidInput');
  if (!resolved.department) throw badRequest('error.invalidInput');
  if (!resolved.project && !resolved.repair) {
    throw new ApiError(400, t('db.checkFailed'), 'project_or_repair_required');
  }

  return {
    emp_num: resolved.employee.emp_num,
    proj_num: resolved.project?.proj_num ?? null,
    fix: resolved.repair?.fix ?? null,
    dept: resolved.department.dept,
  };
}

/**
 * WP §5.6 / §5.1 — how many hours this employee already has on this date, and
 * their target. `excludeId` keeps an edit from counting its own previous value.
 */
async function dayTotals(
  empNum: number,
  date: string,
  excludeId: number | null
): Promise<{ reported: number; target: number; nick: string }> {
  const row = await queryOne<{ reported: number; target: number; nick: string }>(
    `SELECT COALESCE((
              SELECT sum(hours) FROM reports
               WHERE emp_num = e.num AND date = $2 AND ($3::bigint IS NULL OR id <> $3)
            ), 0)::numeric AS reported,
            e.effective_target::numeric AS target,
            e.nick
       FROM employees e WHERE e.num = $1`,
    [empNum, date, excludeId]
  );
  if (!row) throw badRequest('error.invalidInput');
  return row;
}

function overTargetError(
  nick: string,
  date: string,
  newTotal: number,
  target: number
): ApiError {
  return new ApiError(
    409,
    `${nick} would have ${newTotal} hours on ${date}, above the ${target}-hour target. Confirm to continue.`,
    'over_target',
    { nick, date, newTotal, target }
  );
}

/* ------------------------------------------------------------------ create */

reportsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const input = createSchema.parse(req.body);
  const resolved = await resolveOrThrow(input);

  const totals = await dayTotals(resolved.emp_num, input.date, null);
  const newTotal = Number(totals.reported) + input.hours;
  if (newTotal > Number(totals.target) && !input.acknowledgeOverTarget) {
    throw overTargetError(totals.nick, input.date, newTotal, Number(totals.target));
  }

  const row = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO reports (date, emp_num, proj_num, fix, dept, hours, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        input.date,
        resolved.emp_num,
        resolved.proj_num,
        resolved.fix,
        resolved.dept,
        input.hours,
        user.id,
      ]
    );
    const id = inserted.rows[0]!.id;
    await logWith(client, {
      userId: user.id,
      action: ACTION.reportAdd,
      detail: `${totals.nick} · ${input.hours}h · ${resolved.dept} · ${input.date}`,
      entity: ENTITY.report,
      entityKey: id,
    });
    const full = await client.query(`SELECT ${VIEW_COLUMNS} FROM v_reports_full WHERE id = $1`, [id]);
    return full.rows[0]!;
  });

  res.status(201).json({ data: row });
});

/* ------------------------------------------------------------------ update */

const updateSchema = createSchema.partial().extend({
  acknowledgeOverTarget: z.boolean().optional().default(false),
});

reportsRouter.put('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw badRequest('key.invalid');

  const patch = updateSchema.parse(req.body);

  const existing = await queryOne<{
    date: string;
    emp_num: number;
    proj_num: number | null;
    fix: number | null;
    dept: string;
    hours: number;
    emp_nick: string;
  }>(
    `SELECT r.date, r.emp_num, r.proj_num, r.fix, r.dept, r.hours, e.nick AS emp_nick
       FROM reports r JOIN employees e ON e.num = r.emp_num WHERE r.id = $1`,
    [id]
  );
  if (!existing) throw notFound();

  // Only re-resolve what the caller actually sent, so a partial edit cannot
  // accidentally clear the project by omitting it.
  const wantsResolve =
    patch.emp !== undefined ||
    patch.proj !== undefined ||
    patch.dept !== undefined ||
    patch.fix !== undefined;

  const resolved = wantsResolve
    ? await resolveOrThrow({
        emp: patch.emp ?? existing.emp_num,
        proj: patch.proj !== undefined ? patch.proj : existing.proj_num,
        dept: patch.dept ?? existing.dept,
        fix: patch.fix !== undefined ? patch.fix : existing.fix,
      })
    : {
        emp_num: existing.emp_num,
        proj_num: existing.proj_num,
        fix: existing.fix,
        dept: existing.dept,
      };

  const date = patch.date ?? existing.date;
  const hours = patch.hours ?? Number(existing.hours);

  const totals = await dayTotals(resolved.emp_num, date, id);
  const newTotal = Number(totals.reported) + hours;
  const previousTotal = Number(totals.reported) + Number(existing.hours);
  // Only prompt when this edit is what crosses the line — matching the
  // prototype's saveExisting (:529), which stays quiet if the day was already
  // over target before the change.
  if (
    newTotal > Number(totals.target) &&
    previousTotal <= Number(totals.target) &&
    !patch.acknowledgeOverTarget
  ) {
    throw overTargetError(totals.nick, date, newTotal, Number(totals.target));
  }

  const row = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE reports SET date = $2, emp_num = $3, proj_num = $4, fix = $5, dept = $6, hours = $7
        WHERE id = $1 RETURNING id`,
      [id, date, resolved.emp_num, resolved.proj_num, resolved.fix, resolved.dept, hours]
    );
    if (updated.rowCount === 0) throw notFound();
    await logWith(client, {
      userId: user.id,
      action: ACTION.reportEdit,
      detail: `${totals.nick} · ${hours}h · ${resolved.dept} · ${date}`,
      entity: ENTITY.report,
      entityKey: id,
    });
    const full = await client.query(`SELECT ${VIEW_COLUMNS} FROM v_reports_full WHERE id = $1`, [id]);
    return full.rows[0]!;
  });

  res.json({ data: row });
});

/* ------------------------------------------------------------------ delete */

reportsRouter.delete('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw badRequest('key.invalid');

  await withTransaction(async (client) => {
    const existing = await client.query<{ emp_nick: string; date: string; hours: number; dept: string }>(
      `SELECT e.nick AS emp_nick, r.date, r.hours, r.dept
         FROM reports r JOIN employees e ON e.num = r.emp_num WHERE r.id = $1`,
      [id]
    );
    if (existing.rowCount === 0) throw notFound();
    const r = existing.rows[0]!;

    await client.query('DELETE FROM reports WHERE id = $1', [id]);
    await logWith(client, {
      userId: user.id,
      action: ACTION.reportDelete,
      detail: `${r.emp_nick} · ${r.hours}h · ${r.dept} · ${r.date}`,
      entity: ENTITY.report,
      entityKey: id,
    });
  });

  res.status(204).end();
});

/* -------------------------------------------------------------- submit day */

/**
 * WP §7.3 calls this "commit a day's draft rows to the archive". There is no
 * draft state — rows are persisted as they are entered, and the prototype's
 * submitDay (:778) only records a marker and rolls the date forward. This
 * reproduces that: it records who submitted what and when, and locks nothing.
 * See docs/OPEN-QUESTIONS.md #3 before turning it into a real lock.
 */
reportsRouter.post('/submit-day', async (req, res) => {
  const user = currentUser(req);
  const { date } = z.object({ date: isoDate }).parse(req.body);

  const counted = await queryOne<{ n: number; hours: number }>(
    `SELECT count(*)::int AS n, COALESCE(sum(hours), 0)::numeric AS hours
       FROM reports WHERE date = $1`,
    [date]
  );
  if ((counted?.n ?? 0) === 0) {
    throw conflict('error.badRequest');
  }

  const row = await withTransaction(async (client) => {
    const upserted = await client.query(
      `INSERT INTO submitted_days (date, submitted_by, row_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE
         SET submitted_by = EXCLUDED.submitted_by,
             submitted_at = now(),
             row_count    = EXCLUDED.row_count
       RETURNING date, submitted_at, row_count`,
      [date, user.id, counted!.n]
    );
    await logWith(client, {
      userId: user.id,
      action: ACTION.submitDay,
      detail: `${date} · ${counted!.n} rows · ${counted!.hours}h`,
      entity: ENTITY.day,
      entityKey: date,
    });
    return upserted.rows[0]!;
  });

  res.json({ data: row });
});

reportsRouter.get('/submitted-days', async (req, res) => {
  const q = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
  const rows = await query(
    `SELECT s.date, s.submitted_at, s.row_count, u.display_name AS submitted_by_name
       FROM submitted_days s
       LEFT JOIN users u ON u.id = s.submitted_by
      WHERE ($1::date IS NULL OR s.date >= $1) AND ($2::date IS NULL OR s.date <= $2)
      ORDER BY s.date DESC`,
    [q.from ?? null, q.to ?? null]
  );
  res.json({ data: rows, count: rows.length });
});

/**
 * Clearing a submitted-day marker. Admin only: it is the closest thing the system
 * has to editing an audit record.
 */
reportsRouter.delete('/submitted-days/:date', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const date = isoDate.parse(req.params.date);
  await withTransaction(async (client) => {
    const del = await client.query('DELETE FROM submitted_days WHERE date = $1', [date]);
    if (del.rowCount === 0) throw notFound();
    await logWith(client, {
      userId: user.id,
      action: ACTION.submitDay,
      detail: `marker cleared for ${date}`,
      entity: ENTITY.day,
      entityKey: date,
    });
  });
  res.status(204).end();
});
