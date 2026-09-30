/**
 * Excel import — preview then commit (WP §6.5, §7.4, §9.2).
 *
 * Both endpoints take the file as multipart form-data (field `file`) and parse
 * it the same way; preview additionally diffs against the database and commit
 * additionally applies. The client simply posts the same file twice — that
 * keeps the server stateless (no upload token to expire or leak) and makes
 * commit trivially idempotent: whatever is already in the database diffs as
 * `unchanged` and is skipped, so re-importing a file changes nothing (§9.2).
 *
 * Updates use MERGE semantics: only the columns the file carries are written.
 * The prototype replaced whole records on import, which would clobber
 * `targetHours` on every employee re-import and `bucket` on every department
 * re-import — both are maintenance-screen data the files know nothing about.
 *
 * Role: manager/admin (WP §8 — imports are a manager capability).
 */
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../lib/db.ts';
import { ACTION, logWith } from '../lib/activity.ts';
import { badRequest, badRequestText } from '../lib/errors.ts';
import {
  HISTORY_ROW_CAP,
  IMPORT_TYPES,
  MASTER_TYPES,
  WORKBOOK_HISTORY,
  WORKBOOK_SHEETS,
  historyLookups,
  isMasterType,
  parseHistory,
  parseImport,
  type HistoryResult,
  type ImportType,
  type MasterType,
  type ParseResult,
  type RowError,
} from '../lib/importers.ts';
import { tf } from '../lib/messages.ts';
import { MASTER_WRITE, currentUser, requireRole } from '../middleware/auth.ts';
import { namedSheetGrid, readWorkbook, type Workbook } from '../lib/xlsx.ts';

export const importsRouter = Router();

importsRouter.use(requireRole(...MASTER_WRITE));

const upload = multer({
  storage: multer.memoryStorage(),
  // The office's hours workbook (דיווח שעות.xlsm) is ~34 MB — it carries a
  // decade of report history alongside the master lists. nginx allows 64m too.
  limits: { fileSize: 64 * 1024 * 1024, files: 1 },
});

/** multer's own errors carry codes, not HTTP statuses — translate them here. */
const uploadFile: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      next(code === 'LIMIT_FILE_SIZE' ? badRequest('body.tooLarge') : badRequest('import.badFile'));
      return;
    }
    next();
  });
};

/* -------------------------------------------------------------------------- */
/* Per-type diff/apply specs                                                  */
/* -------------------------------------------------------------------------- */

type Item = Record<string, unknown>;

interface TypeSpec {
  /** The business key, as a string, for matching file rows to database rows. */
  key: (it: Item) => string;
  /** Columns the file carries — compared for the diff and written on update. */
  fields: string[];
  /** One-line description of a row for the preview list. */
  label: (it: Item) => string;
  /** Current database rows, keyed like `key`. `items` lets loaders bound the query. */
  load: (items: Item[]) => Promise<Map<string, Item>>;
  /** Upsert one new/changed row inside the commit transaction. */
  apply: (client: PoolClient, it: Item, userId: number) => Promise<void>;
}

/** null/undefined/'' compare equal; everything else compares by value. */
function norm(v: unknown): unknown {
  if (v == null || v === '') return null;
  return v;
}

/** Compares only the fields the file row actually carries (`a`) — an absent field is "keep". */
function differs(fields: string[], a: Item, b: Item): boolean {
  return fields.some((f) => f in a && norm(a[f]) !== norm(b[f]));
}

const toMap = (rows: Item[], key: (r: Item) => string): Map<string, Item> =>
  new Map(rows.map((r) => [key(r), r]));

const SPECS: Record<Exclude<ImportType, 'reports'>, TypeSpec> = {
  employees: {
    key: (it) => String(it.num),
    fields: ['name', 'nick', 'active', 'contractor'],
    label: (it) => `${it.name} (${it.num})`,
    load: async () =>
      toMap(await query('SELECT num, name, nick, active, contractor FROM employees'), (r) =>
        String(r.num)
      ),
    // `active` is present only when the file has a status column; absent, a
    // new employee defaults to active and an existing one keeps its flag.
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO employees (num, name, nick, active, contractor)
         VALUES ($1, $2, $3, COALESCE($4::boolean, true), $5)
         ON CONFLICT (num) DO UPDATE
           SET name = EXCLUDED.name, nick = EXCLUDED.nick, contractor = EXCLUDED.contractor,
               active = COALESCE($4::boolean, employees.active)`,
        [it.num, it.name, it.nick, it.active ?? null, it.contractor]
      );
    },
  },

  projects: {
    key: (it) => String(it.num),
    // `nick` is written on INSERT only: the workbook's nick column (G) is just
    // the project number, and must not overwrite the short nicknames the office
    // types in the hours grid ("נטו", "דבאח"). Edit those in Master Data.
    fields: ['name', 'client', 'overhead', 'archived'],
    label: (it) => `${it.name} (${it.num})`,
    load: async () =>
      toMap(await query('SELECT num, name, nick, client, overhead, archived FROM projects'), (r) =>
        String(r.num)
      ),
    // `archived` is only ever false from ProjectNum (a listed project is live);
    // COALESCE keeps it as-is for any caller whose rows do not carry it.
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO projects (num, name, nick, client, overhead, archived)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::boolean, false))
         ON CONFLICT (num) DO UPDATE
           SET name = EXCLUDED.name,
               client = EXCLUDED.client, overhead = EXCLUDED.overhead,
               archived = COALESCE($6::boolean, projects.archived)`,
        [it.num, it.name, it.nick, it.client, it.overhead, it.archived ?? null]
      );
    },
  },

  departments: {
    key: (it) => String(it.name),
    fields: ['num'],
    label: (it) => String(it.name),
    load: async () => toMap(await query('SELECT name, num FROM departments'), (r) => String(r.name)),
    // bucket is deliberately untouched: the file does not carry it, and nulling
    // it would silently drop the department out of the dashboard's buckets.
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO departments (name, num) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET num = EXCLUDED.num`,
        [it.name, it.num]
      );
    },
  },

  standard: {
    key: (it) => String(it.box),
    fields: ['name', 'parent', 'total', 'pah', 'misgarot', 'hazraka', 'panelim', 'hadbaka', 'ritum', 'dlatot', 'hashmal', 'psei', 'hashlamot'],
    label: (it) => `${it.box} · ${String(it.name).slice(0, 26)} · ${it.total}`,
    load: async () =>
      toMap(
        await query(
          `SELECT box, name, parent, total, pah, misgarot, hazraka, panelim,
                  hadbaka, ritum, dlatot, hashmal, psei, hashlamot FROM standard`
        ),
        (r) => String(r.box)
      ),
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO standard (box, name, parent, total, pah, misgarot, hazraka,
                               panelim, hadbaka, ritum, dlatot, hashmal, psei, hashlamot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (box) DO UPDATE
           SET name = EXCLUDED.name, parent = EXCLUDED.parent, total = EXCLUDED.total,
               pah = EXCLUDED.pah, misgarot = EXCLUDED.misgarot, hazraka = EXCLUDED.hazraka,
               panelim = EXCLUDED.panelim, hadbaka = EXCLUDED.hadbaka, ritum = EXCLUDED.ritum,
               dlatot = EXCLUDED.dlatot, hashmal = EXCLUDED.hashmal, psei = EXCLUDED.psei,
               hashlamot = EXCLUDED.hashlamot`,
        [it.box, it.name, it.parent, it.total, it.pah, it.misgarot, it.hazraka, it.panelim, it.hadbaka, it.ritum, it.dlatot, it.hashmal, it.psei, it.hashlamot]
      );
    },
  },

  repairs: {
    key: (it) => String(it.fix),
    // The workbook's repairs sheet has number + customer only (A, B): date and
    // model are left as they are rather than nulled.
    // `closed` is only ever false from the sheet (a listed ticket is open): a
    // ticket closed by an earlier import comes back when it reappears (007).
    fields: ['client', 'closed'],
    label: (it) => `${it.fix} · ${it.client}`,
    load: async () => toMap(await query('SELECT fix, client, closed FROM repairs'), (r) => String(r.fix)),
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO repairs (fix, client, closed) VALUES ($1, $2, COALESCE($3::boolean, false))
         ON CONFLICT (fix) DO UPDATE
           SET client = EXCLUDED.client, closed = COALESCE($3::boolean, repairs.closed)`,
        [it.fix, it.client, it.closed ?? null]
      );
    },
  },

  attendance: {
    key: (it) => `${it.date}|${it.emp_num}`,
    fields: ['hours'],
    label: (it) => `${it.emp_num} · ${it.date} · ${it.hours}`,
    load: async (items) => {
      const dates = [...new Set(items.map((it) => it.date))];
      if (dates.length === 0) return new Map();
      return toMap(
        await query('SELECT date, emp_num, hours FROM attendance WHERE date = ANY($1)', [dates]),
        (r) => `${r.date}|${r.emp_num}`
      );
    },
    apply: async (client, it, userId) => {
      await client.query(
        `INSERT INTO attendance (date, emp_num, hours, source, updated_by)
         VALUES ($1, $2, $3, 'import', $4)
         ON CONFLICT (date, emp_num) DO UPDATE
           SET hours = EXCLUDED.hours, source = 'import',
               updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [it.date, it.emp_num, it.hours, userId]
      );
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Shared parse + diff                                                        */
/* -------------------------------------------------------------------------- */

interface Diff {
  toApply: Item[];
  counts: { new: number; updated: number; unchanged: number; invalid: number };
  rows: { status: 'new' | 'update' | 'unchanged'; label: string; changes?: Change[] }[];
  errors: RowError[];
}

/** One changed column of an updated row — the preview shows "field: from → to". */
interface Change {
  field: string;
  from: unknown;
  to: unknown;
}

function parseType(req: { params: { type?: string } }): ImportType {
  const type = req.params.type as ImportType;
  if (!IMPORT_TYPES.includes(type)) throw badRequest('import.unknownType');
  return type;
}

/** Master lists read only their named sheets out of the (large) hours workbook. */
function read(buf: Buffer, sheets?: string[], rowCap?: number): Workbook {
  try {
    return readWorkbook(buf, sheets, rowCap);
  } catch {
    throw badRequest('import.badFile');
  }
}

/** Parse one type; a missing sheet/header is fatal, an empty sheet is left to the caller. */
async function parseChecked(type: ImportType, wb: Workbook): Promise<ParseResult> {
  const parsed = await parseImport(type, wb);
  if (parsed.sheetMissing) throw badRequestText(tf('import.sheetMissing', { sheet: parsed.sheetMissing }));
  if (parsed.headerMissing) throw badRequest('import.headerNotFound');
  return parsed;
}

const isEmpty = (p: ParseResult) => p.items.length === 0 && p.errors.length === 0;

async function diffParsed(type: ImportType, parsed: ParseResult): Promise<Diff> {
  const errors = [...parsed.errors];
  let items = parsed.items;

  if (type === 'reports') {
    // No natural key: idempotency comes from consuming exact duplicates. Each
    // identical row already in the database absorbs one identical file row;
    // anything beyond that count is genuinely new.
    const dates = [...new Set(items.map((it) => it.date))];
    const existing = dates.length
      ? await query('SELECT date, emp_num, proj_num, fix, dept, hours FROM reports WHERE date = ANY($1)', [dates])
      : [];
    const sig = (r: Item) => [r.date, r.emp_num, r.proj_num ?? '', r.fix ?? '', r.dept, Number(r.hours)].join('|');
    const pool = new Map<string, number>();
    for (const r of existing) pool.set(sig(r), (pool.get(sig(r)) ?? 0) + 1);

    const toApply: Item[] = [];
    const rows: Diff['rows'] = [];
    let unchanged = 0;
    for (const it of items) {
      const s = sig(it);
      const left = pool.get(s) ?? 0;
      const label = `${it.date} · ${it.emp_num} · ${Number(it.hours)}h`;
      if (left > 0) {
        pool.set(s, left - 1);
        unchanged++;
        rows.push({ status: 'unchanged', label });
      } else {
        toApply.push(it);
        rows.push({ status: 'new', label });
      }
    }
    return {
      toApply,
      counts: { new: toApply.length, updated: 0, unchanged, invalid: errors.length },
      rows,
      errors,
    };
  }

  const spec = SPECS[type];

  // A key that appears twice in one file would be upserted twice (last wins)
  // and counted twice in the preview. The office's employee sheet has one such
  // number today — the first occurrence is kept and the repeat reported.
  {
    const firstRow = new Map<string, number>();
    const ok: Item[] = [];
    for (const it of items) {
      const k = spec.key(it);
      const seen = firstRow.get(k);
      if (seen != null) {
        errors.push({ row: (it.__row as number) ?? 0, reason: tf('import.dupInFile', { key: k, first: seen }) });
      } else {
        firstRow.set(k, (it.__row as number) ?? 0);
        ok.push(it);
      }
    }
    items = ok;
  }

  if (type === 'standard') {
    // standard.parent is a NOT VALID FK: the pre-existing orphans are tolerated,
    // but a NEW parent value must exist or the insert/update fails. Rows that
    // would introduce (or change to) a missing parent become row errors — with
    // the fix spelled out — instead of blowing up the whole transaction.
    const parents = new Set(
      (await query<{ num: number }>('SELECT num FROM projects')).map((p) => p.num)
    );
    const current = await spec.load(items);
    const ok: Item[] = [];
    for (const it of items) {
      const parent = it.parent as number | null;
      const ex = current.get(spec.key(it));
      const introducesParent = parent != null && !parents.has(parent) && (!ex || ex.parent !== parent);
      if (introducesParent) {
        errors.push({ row: (it.__row as number) ?? 0, reason: tf('import.parentNotFound', { n: parent! }) });
      } else {
        ok.push(it);
      }
    }
    items = ok;
  }

  if (type === 'attendance') {
    // attendance.emp_num is a plain FK — unknown employees must become row
    // errors, not a transaction failure.
    const emps = new Set((await query<{ num: number }>('SELECT num FROM employees')).map((e) => e.num));
    const ok: Item[] = [];
    for (const it of items) {
      if (emps.has(it.emp_num as number)) ok.push(it);
      else
        errors.push({
          row: (it.__row as number) ?? 0,
          reason: tf('import.attEmpNotFound', { n: it.emp_num as number }),
        });
    }
    items = ok;
  }

  const current = await spec.load(items);
  const toApply: Item[] = [];
  const rows: Diff['rows'] = [];
  let newN = 0,
    updN = 0,
    sameN = 0;
  for (const it of items) {
    const ex = current.get(spec.key(it));
    if (!ex) {
      newN++;
      toApply.push(it);
      rows.push({ status: 'new', label: spec.label(it) });
    } else if (differs(spec.fields, it, ex)) {
      updN++;
      toApply.push(it);
      const changes = spec.fields
        .filter((f) => f in it && norm(it[f]) !== norm(ex[f]))
        .map((f) => ({ field: f, from: norm(ex[f]), to: norm(it[f]) }));
      rows.push({ status: 'update', label: spec.label(it), changes });
    } else {
      sameN++;
      rows.push({ status: 'unchanged', label: spec.label(it) });
    }
  }

  return {
    toApply,
    counts: { new: newN, updated: updN, unchanged: sameN, invalid: errors.length },
    rows,
    errors,
  };
}

async function parseAndDiff(type: ImportType, buf: Buffer): Promise<Diff> {
  const wb = read(buf, isMasterType(type) ? WORKBOOK_SHEETS : undefined);
  const parsed = await parseChecked(type, wb);
  if (isEmpty(parsed)) throw badRequest('import.noRows');
  return diffParsed(type, parsed);
}

/**
 * Rows per multi-row INSERT. The workbook history is ~200k report rows: one
 * round trip each to the Supabase pooler would take many minutes, so rows go
 * in as arrays through unnest().
 */
const BATCH = 5000;

async function inBatches(rows: Item[], run: (batch: Item[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await run(rows.slice(i, i + BATCH));
}

const colOf = (rows: Item[], key: string) => rows.map((r) => r[key] ?? null);

async function insertReports(client: PoolClient, rows: Item[], userId: number) {
  await inBatches(rows, (b) =>
    client.query(
      `INSERT INTO reports (date, emp_num, proj_num, fix, dept, hours, created_by)
       SELECT d, e, p, f, dp, h, $7
         FROM unnest($1::date[], $2::int[], $3::int[], $4::int[], $5::text[], $6::numeric[])
              AS t(d, e, p, f, dp, h)`,
      [colOf(b, 'date'), colOf(b, 'emp_num'), colOf(b, 'proj_num'), colOf(b, 'fix'), colOf(b, 'dept'), colOf(b, 'hours'), userId]
    )
  );
}

/**
 * The records the report history needs but master data lacks (see
 * parseHistory). DO NOTHING on conflict: these are placeholders for FKs and
 * must never overwrite a record that exists by commit time.
 */
async function applyHistoryCreates(client: PoolClient, creates: HistoryResult['creates']) {
  await inBatches(creates.employees, (b) =>
    client.query(
      `INSERT INTO employees (num, name, nick, active, contractor)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::boolean[], $5::text[])
       ON CONFLICT (num) DO NOTHING`,
      [colOf(b, 'num'), colOf(b, 'name'), colOf(b, 'nick'), colOf(b, 'active'), colOf(b, 'contractor')]
    )
  );
  await inBatches(creates.projects, (b) =>
    client.query(
      `INSERT INTO projects (num, name, nick, client, overhead, archived)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::boolean[], $6::boolean[])
       ON CONFLICT (num) DO NOTHING`,
      [colOf(b, 'num'), colOf(b, 'name'), colOf(b, 'nick'), colOf(b, 'client'), colOf(b, 'overhead'), colOf(b, 'archived')]
    )
  );
  await inBatches(creates.repairs, (b) =>
    client.query(
      // Closed: a ticket known only from history is not on the repairs sheet,
      // so it must not be offered in the grid (client feedback round 3 #4).
      `INSERT INTO repairs (fix, client, closed)
       SELECT f, c, true FROM unnest($1::int[], $2::text[]) AS t(f, c)
       ON CONFLICT (fix) DO NOTHING`,
      [colOf(b, 'fix'), colOf(b, 'client')]
    )
  );
}

/** Writes a diff's rows + its activity-log entry, inside the caller's transaction. */
async function applyDiff(client: PoolClient, type: ImportType, diff: Diff, userId: number, detailExtra = '') {
  if (diff.toApply.length === 0) return;
  if (type === 'reports') {
    await insertReports(client, diff.toApply, userId);
  } else {
    const spec = SPECS[type];
    for (const it of diff.toApply) await spec.apply(client, it, userId);
  }
  // WP §9.2: one activity-log entry per committed import, in the same
  // transaction as the data it describes.
  await logWith(client, {
    userId,
    action: ACTION.import,
    detail: `${type} · +${diff.counts.new} ~${diff.counts.updated} =${diff.counts.unchanged} !${diff.counts.invalid}${detailExtra}`,
    entityKey: type,
  });
}

/**
 * The preview lists every row that will change (new + updated) so the user can
 * review exactly what the commit adds — client feedback round 3 #8 ("shows
 * strange items", "no addition/removal confirmation"). Unchanged rows are only
 * counted, and so are report-history rows: there are ~200k of them.
 */
const PREVIEW_ROWS_CAP = 1000;
const ERRORS_CAP = 500;

const previewOf = (type: ImportType, diff: Diff, removals?: Removal[]) => {
  const changed = type === 'reports' ? [] : diff.rows.filter((r) => r.status !== 'unchanged');
  return {
    type,
    counts: diff.counts,
    rows: changed.slice(0, PREVIEW_ROWS_CAP),
    rowsTruncated: Math.max(0, changed.length - PREVIEW_ROWS_CAP),
    errors: diff.errors.slice(0, ERRORS_CAP),
    errorsTruncated: Math.max(0, diff.errors.length - ERRORS_CAP),
    ...(removals ? { removals } : {}),
  };
};

/* ------------------------------------------------------------- removals */

/**
 * Client feedback round 3 #3/#4: records that exist in the system but are no
 * longer in the uploaded workbook are offered for REMOVAL in the preview, and
 * only the ones the user confirms are removed. "Removed" is a flag, never a
 * DELETE — past reports still reference these rows (FKs) and the history must
 * stay intact:
 *
 *   employees → active = false   (out of the grid's employee suggestions)
 *   projects  → archived = true  (out of the project suggestions, migration 006)
 *   repairs   → closed = true    (out of the ticket suggestions, migration 007)
 *
 * A record that reappears in a later upload comes back: ProjectNum un-archives,
 * the repairs sheet re-opens, and the employees' status column re-activates.
 */
type RemovableType = 'employees' | 'projects' | 'repairs';
const REMOVABLE_TYPES: RemovableType[] = ['employees', 'projects', 'repairs'];
const isRemovable = (t: string): t is RemovableType => (REMOVABLE_TYPES as string[]).includes(t);

interface Removal {
  key: number;
  label: string;
  /**
   * Why this one may still be live, despite missing from the file — the office
   * copy of the workbook can be OLDER than what was entered in the app since
   * (first real import, 2026-09-30: it removed projects and tickets numbered
   * above anything in the file, and a project reported the day before):
   *   newer  — numbered above every record in the file
   *   recent — hours reported against it in the last RECENT_DAYS days
   */
  warn?: ('newer' | 'recent')[];
  /** Latest report date, when it has any. */
  lastReport?: string | null;
}

const RECENT_DAYS = 30;

const REMOVABLE: Record<RemovableType, { candidates: string; apply: string; label: (r: Item) => string }> = {
  employees: {
    candidates: `SELECT e.num AS key, e.nick, e.name,
                        (SELECT max(date) FROM reports r WHERE r.emp_num = e.num)::text AS last_report
                   FROM employees e WHERE e.active ORDER BY e.nick`,
    apply: 'UPDATE employees SET active = false WHERE active AND num = ANY($1::int[])',
    label: (r) => `${r.nick} · ${r.name} (${r.key})`,
  },
  projects: {
    candidates: `SELECT p.num AS key, p.name,
                        (SELECT max(date) FROM reports r WHERE r.proj_num = p.num)::text AS last_report
                   FROM projects p WHERE NOT p.archived ORDER BY p.num`,
    apply: 'UPDATE projects SET archived = true WHERE NOT archived AND num = ANY($1::int[])',
    label: (r) => `${r.name} (${r.key})`,
  },
  repairs: {
    // reports has no index on fix: one grouped scan, not a lookup per ticket.
    candidates: `SELECT x.fix AS key, x.client, lr.last::text AS last_report
                   FROM repairs x
                   LEFT JOIN (SELECT fix, max(date) AS last FROM reports WHERE fix IS NOT NULL GROUP BY fix) lr
                          ON lr.fix = x.fix
                  WHERE NOT x.closed ORDER BY x.fix DESC`,
    apply: 'UPDATE repairs SET closed = true WHERE NOT closed AND fix = ANY($1::int[])',
    label: (r) => `${r.key}${r.client ? ` · ${r.client}` : ''}`,
  },
};

/**
 * Active records of `type` whose key is not in the file's list. An EMPTY list
 * offers nothing: a blank sheet must never read as "remove everyone".
 */
async function removalCandidates(type: RemovableType, fileItems: Item[]): Promise<Removal[]> {
  if (fileItems.length === 0) return [];
  const inFile = new Set(fileItems.map((it) => SPECS[type].key(it)));
  const fileMax = Math.max(...fileItems.map((it) => Number(SPECS[type].key(it))).filter(Number.isFinite));
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await query<Item>(REMOVABLE[type].candidates);
  return rows
    .filter((r) => !inFile.has(String(r.key)))
    .map((r) => {
      const key = Number(r.key);
      const last = (r.last_report as string | null) ?? null;
      const warn: NonNullable<Removal['warn']> = [];
      if (key > fileMax) warn.push('newer');
      if (last && last >= since) warn.push('recent');
      return { key, label: REMOVABLE[type].label(r), lastReport: last, ...(warn.length ? { warn } : {}) };
    });
}

/** The commit's `remove` form field — JSON of the keys the user confirmed, per type. */
function parseRemoveField(raw: unknown): Record<RemovableType, number[]> {
  const out: Record<RemovableType, number[]> = { employees: [], projects: [], repairs: [] };
  if (typeof raw !== 'string' || raw.trim() === '') return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest('error.invalidInput');
  }
  for (const type of REMOVABLE_TYPES) {
    const list = (parsed as Record<string, unknown> | null)?.[type];
    if (Array.isArray(list)) out[type] = list.map(Number).filter(Number.isInteger);
  }
  return out;
}

/* ------------------------------------------------- whole-workbook import */

/**
 * The office's hours workbook (דיווח שעות.xlsm) is the ONE upload (Arad,
 * 2026-09-29): the four master lists at fixed sheets/columns (lib/importers
 * WORKBOOK_LAYOUT) plus the report history in "דיווחי שעות" (WORKBOOK_HISTORY).
 * The office re-uploads the same file as it grows, so everything here is
 * idempotent — lists diff by key, history rows by consumed duplicates.
 *
 * Commit is one transaction, in FK order: master lists, then the records the
 * history needs but the lists lack (former employees, old projects, tickets),
 * then the report rows.
 *
 * Registered before `/:type/...` so `workbook` is not taken for a type name.
 */
type WorkbookSection = MasterType | 'reports';

interface WorkbookDiff {
  sections: { type: WorkbookSection; diff: Diff; removals?: Removal[] }[];
  creates: HistoryResult['creates'];
}

async function diffWorkbook(buf: Buffer): Promise<WorkbookDiff> {
  const wb = read(buf, WORKBOOK_SHEETS);
  const parsed = await Promise.all(MASTER_TYPES.map((type) => parseChecked(type, wb)));

  // The history sheet is read on its own (see readWorkbook) — ~200k rows.
  const histGrid = namedSheetGrid(read(buf, [...WORKBOOK_HISTORY.sheets], HISTORY_ROW_CAP), [
    ...WORKBOOK_HISTORY.sheets,
  ]);
  if (!histGrid) throw badRequestText(tf('import.sheetMissing', { sheet: WORKBOOK_HISTORY.sheets[0] }));
  const fileMasters = Object.fromEntries(
    MASTER_TYPES.map((type, i) => [type, parsed[i]!.items])
  ) as Record<MasterType, Item[]>;
  const history = parseHistory(histGrid, await historyLookups(fileMasters));
  if (history.headerMissing) throw badRequest('import.headerNotFound');

  if (parsed.every(isEmpty) && isEmpty(history)) throw badRequest('import.noRows');
  const sections: WorkbookDiff['sections'] = [];
  for (let i = 0; i < MASTER_TYPES.length; i++) {
    const type = MASTER_TYPES[i]!;
    sections.push({
      type,
      diff: await diffParsed(type, parsed[i]!),
      ...(isRemovable(type) ? { removals: await removalCandidates(type, parsed[i]!.items) } : {}),
    });
  }
  sections.push({ type: 'reports', diff: await diffParsed('reports', history) });
  return { sections, creates: history.creates };
}

const sumCounts = (sections: { diff: Diff }[]): Diff['counts'] =>
  sections.reduce(
    (a, { diff: { counts: c } }) => ({
      new: a.new + c.new,
      updated: a.updated + c.updated,
      unchanged: a.unchanged + c.unchanged,
      invalid: a.invalid + c.invalid,
    }),
    { new: 0, updated: 0, unchanged: 0, invalid: 0 }
  );

const createCounts = (c: HistoryResult['creates']) => ({
  employees: c.employees.length,
  projects: c.projects.length,
  repairs: c.repairs.length,
});

importsRouter.post('/workbook/preview', uploadFile, async (req, res) => {
  if (!req.file) throw badRequest('import.noFile');
  const { sections, creates } = await diffWorkbook(req.file.buffer);
  res.json({
    data: {
      counts: sumCounts(sections),
      creates: createCounts(creates),
      sections: sections.map(({ type, diff, removals }) => previewOf(type, diff, removals)),
    },
  });
});

importsRouter.post('/workbook/commit', uploadFile, async (req, res) => {
  if (!req.file) throw badRequest('import.noFile');
  const user = currentUser(req);
  const requested = parseRemoveField(req.body?.remove);
  const { sections, creates } = await diffWorkbook(req.file.buffer);
  const counts = sumCounts(sections);
  const made = createCounts(creates);

  // Only keys that are STILL removal candidates at commit time are removed: the
  // preview may be stale, and a request can never flag an arbitrary record.
  const toRemove: Record<RemovableType, number[]> = { employees: [], projects: [], repairs: [] };
  for (const { type, removals } of sections) {
    if (!removals || !isRemovable(type)) continue;
    const want = new Set(requested[type]);
    toRemove[type] = removals.filter((r) => want.has(r.key)).map((r) => r.key);
  }
  const removedTotal = REMOVABLE_TYPES.reduce((n, t) => n + toRemove[t].length, 0);

  if (counts.new + counts.updated + removedTotal > 0) {
    await withTransaction(async (client) => {
      for (const { type, diff } of sections) {
        if (type === 'reports') {
          await applyHistoryCreates(client, creates);
          await applyDiff(client, type, diff, user.id, ` · created emp ${made.employees} proj ${made.projects} fix ${made.repairs}`);
        } else {
          await applyDiff(client, type, diff, user.id);
        }
      }
      for (const type of REMOVABLE_TYPES) {
        const keys = toRemove[type];
        if (keys.length === 0) continue;
        await client.query(REMOVABLE[type].apply, [keys]);
        await logWith(client, {
          userId: user.id,
          action: ACTION.import,
          detail: `${type} · removed ${keys.length}: ${keys.slice(0, 40).join(', ')}${keys.length > 40 ? ' …' : ''}`,
          entityKey: type,
        });
      }
    });
  }

  res.json({
    data: {
      applied: counts.new + counts.updated + removedTotal,
      counts,
      creates: made,
      removed: toRemove,
      sections: sections.map(({ type, diff }) => ({
        type,
        applied: diff.counts.new + diff.counts.updated,
        counts: diff.counts,
      })),
    },
  });
});

/* ------------------------------------------------------- per-type routes */

importsRouter.post('/:type/preview', uploadFile, async (req, res) => {
  const type = parseType(req);
  if (!req.file) throw badRequest('import.noFile');

  const diff = await parseAndDiff(type, req.file.buffer);
  res.json({ data: previewOf(type, diff) });
});

importsRouter.post('/:type/commit', uploadFile, async (req, res) => {
  const type = parseType(req);
  if (!req.file) throw badRequest('import.noFile');
  const user = currentUser(req);

  const diff = await parseAndDiff(type, req.file.buffer);

  if (diff.toApply.length > 0) {
    await withTransaction((client) => applyDiff(client, type, diff, user.id));
  }

  res.json({
    data: {
      type,
      applied: diff.counts.new + diff.counts.updated,
      counts: diff.counts,
      errors: diff.errors.slice(0, ERRORS_CAP),
      errorsTruncated: Math.max(0, diff.errors.length - ERRORS_CAP),
    },
  });
});
