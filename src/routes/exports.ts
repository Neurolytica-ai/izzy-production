/**
 * Excel exports (WP §7.4, §9.3): the reporting grid, the archive, and the
 * activity log, as .xlsx with the exact Hebrew headers and file names the
 * prototype produced (:773-825) — the office knows these files.
 *
 * Each export accepts the same filter parameters as the list view it mirrors,
 * so "the Excel export reflects exactly the current filter and sort" (§6.2)
 * holds by construction: the client passes its current query string through.
 *
 * Any signed-in role may export — an export is just a different rendering of a
 * list the user can already read (WP §8 gives reporters the archive and
 * dashboard views; §9.3 wants every list view exportable).
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.ts';
import { badRequest } from '../lib/errors.ts';
import { actionLabel, entityLabel, t } from '../lib/messages.ts';
import { workbookBuffer } from '../lib/xlsx.ts';

export const exportsRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('field.dateFormat'));

function sendWorkbook(
  res: { setHeader: (k: string, v: string) => void; send: (b: Buffer) => void },
  rows: Record<string, unknown>[],
  sheet: string,
  filename: string
): void {
  const buf = workbookBuffer(rows, sheet);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  // ASCII fallback plus RFC 5987 for the real (Hebrew) name.
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=export.xlsx; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(buf);
}

/** dd/mm/yyyy, the prototype's fmtDate — used only where it used it (the log). */
function fmtDate(iso: string): string {
  const p = iso.split('-');
  return `${p[2]}/${p[1]}/${p[0]}`;
}

/* ------------------------------------------------------- the reporting grid */

const gridQuery = z.object({ date: isoDate.optional() });

exportsRouter.get('/report', async (req, res) => {
  const q = gridQuery.parse(req.query);
  const rows = await query<Record<string, any>>(
    `SELECT date, emp_nick, emp_num, emp_name, proj_nick, proj_num,
            display_proj_name, fix, dept, dept_num, hours
       FROM v_reports_full
      WHERE ($1::date IS NULL OR date = $1)
      ORDER BY date DESC, emp_nick, id`,
    [q.date ?? null]
  );
  // Headers from the prototype's exportBtn (:821-823).
  const out = rows.map((r) => ({
    'תאריך דיווח': r.date,
    'עובד': r.emp_nick,
    "שם הפרויקט + מס'": r.proj_nick ?? (r.fix != null ? 'תיקון' : ''),
    'דיווח שעות': Number(r.hours),
    'מחלקה': r.dept,
    'מס תיקון': r.fix ?? '',
    'מס פרויקט': r.proj_num ?? '',
    'שם הפרויקט': r.display_proj_name ?? '',
    'מס עובד': r.emp_num,
    'מס מחלקה': r.dept_num ?? '',
    'שם עובד': r.emp_name,
  }));
  sendWorkbook(res, out, 'דיווח', 'דיווח_ייצור.xlsx');
});

/* ------------------------------------------------------------- the archive */

const archiveQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().max(120).optional(),
  sort: z
    .enum(['date', 'emp_nick', 'emp_name', 'proj_nick', 'proj_name', 'client', 'dept', 'hours', 'fix'])
    .default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

exportsRouter.get('/archive', async (req, res) => {
  const q = archiveQuery.parse(req.query);

  const where: string[] = [];
  const values: unknown[] = [];
  if (q.from) {
    values.push(q.from);
    where.push(`date >= $${values.length}`);
  }
  if (q.to) {
    values.push(q.to);
    where.push(`date <= $${values.length}`);
  }
  if (q.q) {
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
  const orderSql = `ORDER BY ${q.sort} ${q.dir.toUpperCase()} NULLS LAST, id ${q.dir.toUpperCase()}`;

  const rows = await query<Record<string, any>>(
    `SELECT date, emp_nick, emp_name, proj_nick, proj_num, display_proj_name,
            client, repair_client, dept, dept_num, hours, fix, emp_num
       FROM v_reports_full ${whereSql} ${orderSql}`,
    values
  );
  // Headers from the prototype's archExport (:774-776).
  const out = rows.map((r) => ({
    'תאריך': r.date,
    'עובד': r.emp_nick,
    'שם עובד': r.emp_name,
    'פרויקט': r.proj_nick ?? (r.fix != null ? 'תיקון' : ''),
    'שם הפרויקט': r.display_proj_name ?? '',
    'לקוח': r.client ?? r.repair_client ?? '',
    'מחלקה': r.dept,
    'שעות': Number(r.hours),
    'תיקון': r.fix ?? '',
    'מס פרויקט': r.proj_num ?? '',
    'מס עובד': r.emp_num,
    'מס מחלקה': r.dept_num ?? '',
  }));
  sendWorkbook(res, out, 'מאגר', 'מאגר_דיווחים.xlsx');
});

/* -------------------------------------------------------- the activity log */

const logQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  action: z.string().max(40).optional(),
  q: z.string().max(120).optional(),
});

exportsRouter.get('/activity', async (req, res) => {
  const q = logQuery.parse(req.query);

  const where: string[] = [];
  const values: unknown[] = [];
  if (q.from) {
    values.push(q.from);
    where.push(`a.ts >= $${values.length}::date`);
  }
  if (q.to) {
    values.push(q.to);
    where.push(`a.ts < $${values.length}::date + interval '1 day'`);
  }
  if (q.action) {
    values.push(q.action);
    where.push(`a.action = $${values.length}`);
  }
  if (q.q) {
    const needle = `%${q.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    values.push(needle);
    const p = `$${values.length}`;
    where.push(`(a.detail ILIKE ${p} OR u.display_name ILIKE ${p})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query<Record<string, any>>(
    `SELECT a.ts, u.display_name AS user_name, a.action, a.entity, a.detail
       FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
      ORDER BY a.ts DESC, a.id DESC`,
    values
  );
  // Headers from the prototype's logExport (:815); action codes become the
  // catalogue labels in the server language, like the on-screen log.
  const out = rows.map((r) => {
    // 'sv-SE' renders as `yyyy-mm-dd hh:mm:ss`; the office reads Israel time.
    const ts = new Date(r.ts).toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' });
    return {
      'תאריך': fmtDate(ts.slice(0, 10)),
      'שעה': ts.slice(11, 19),
      'משתמש': r.user_name ?? '',
      'פעולה': actionLabel(r.action),
      'רשומה': entityLabel(r.entity) ?? '',
      'פרטים': r.detail,
    };
  });
  sendWorkbook(res, out, 'יומן', 'יומן_פעולות.xlsx');
});

exportsRouter.get('/:view', () => {
  throw badRequest('error.apiRouteMissing');
});
