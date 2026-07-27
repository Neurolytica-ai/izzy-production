/**
 * Attendance clock hours and the daily coverage view (WP §7.3).
 *
 * The coverage screen itself is Phase 4, but the endpoint lands here because the
 * hours-entry grid needs the same per-employee daily totals for its status dots
 * (WP §5.6). Computing that twice — once for the grid, once for the coverage
 * screen — is how the two end up disagreeing, so both read fn_coverage.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../lib/db.ts';
import { ACTION, ENTITY, logWith } from '../lib/activity.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { MASTER_WRITE, currentUser, requireRole } from '../middleware/auth.ts';
import { t } from '../lib/messages.ts';

export const attendanceRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('field.dateFormat'));

/**
 * WP §5.5/§5.6 — one row per active employee for a date: reported hours, target,
 * status, clock hours, variance, and whether the variance exceeds ±1 hour.
 */
attendanceRouter.get('/coverage', async (req, res) => {
  const { date } = z.object({ date: isoDate }).parse(req.query);
  const rows = await query('SELECT * FROM fn_coverage($1)', [date]);
  res.json({ data: rows, count: rows.length });
});

attendanceRouter.get('/attendance', async (req, res) => {
  const q = z.object({ date: isoDate.optional(), from: isoDate.optional(), to: isoDate.optional() }).parse(
    req.query
  );
  const rows = await query(
    `SELECT a.date, a.emp_num, e.nick AS emp_nick, e.name AS emp_name, a.hours, a.source, a.updated_at
       FROM attendance a JOIN employees e ON e.num = a.emp_num
      WHERE ($1::date IS NULL OR a.date = $1)
        AND ($2::date IS NULL OR a.date >= $2)
        AND ($3::date IS NULL OR a.date <= $3)
      ORDER BY a.date DESC, e.nick`,
    [q.date ?? null, q.from ?? null, q.to ?? null]
  );
  res.json({ data: rows, count: rows.length });
});

/**
 * Upsert clock hours for one employee/day. Editing these is a manager action:
 * the attendance figure is what production hours are reconciled against, so a
 * reporter being able to adjust it would defeat the cross-check.
 */
const upsertSchema = z.object({
  date: isoDate,
  emp_num: z.coerce.number().int().positive(),
  /** null clears the entry, which is how the prototype's blank input behaves. */
  hours: z.coerce.number().min(0).max(24).nullable(),
});

attendanceRouter.put('/attendance', requireRole(...MASTER_WRITE), async (req, res) => {
  const user = currentUser(req);
  const input = upsertSchema.parse(req.body);

  const result = await withTransaction(async (client) => {
    const emp = await client.query<{ nick: string }>('SELECT nick FROM employees WHERE num = $1', [
      input.emp_num,
    ]);
    if (emp.rowCount === 0) throw badRequest('error.invalidInput');
    const nick = emp.rows[0]!.nick;

    if (input.hours === null) {
      const deleted = await client.query(
        'DELETE FROM attendance WHERE date = $1 AND emp_num = $2',
        [input.date, input.emp_num]
      );
      if (deleted.rowCount === 0) throw notFound();
      await logWith(client, {
        userId: user.id,
        action: ACTION.attendanceClear,
        detail: `${nick} · ${input.date}`,
        entity: ENTITY.attendance,
        entityKey: `${input.date}|${input.emp_num}`,
      });
      return null;
    }

    const upserted = await client.query(
      `INSERT INTO attendance (date, emp_num, hours, source, updated_by)
       VALUES ($1, $2, $3, 'manual', $4)
       ON CONFLICT (date, emp_num) DO UPDATE
         SET hours = EXCLUDED.hours,
             source = 'manual',
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
       RETURNING date, emp_num, hours, source, updated_at`,
      [input.date, input.emp_num, input.hours, user.id]
    );
    await logWith(client, {
      userId: user.id,
      action: ACTION.attendanceSet,
      detail: `${nick} · ${input.date} · ${input.hours}h`,
      entity: ENTITY.attendance,
      entityKey: `${input.date}|${input.emp_num}`,
    });
    return upserted.rows[0]!;
  });

  if (result === null) {
    res.status(204).end();
    return;
  }
  res.json({ data: result });
});
