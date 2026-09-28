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
  IMPORT_TYPES,
  MASTER_TYPES,
  WORKBOOK_SHEETS,
  isMasterType,
  parseImport,
  type ImportType,
  type MasterType,
  type ParseResult,
  type RowError,
} from '../lib/importers.ts';
import { tf } from '../lib/messages.ts';
import { MASTER_WRITE, currentUser, requireRole } from '../middleware/auth.ts';
import { readWorkbook, type Workbook } from '../lib/xlsx.ts';

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
    fields: ['name', 'client', 'overhead'],
    label: (it) => `${it.name} (${it.num})`,
    load: async () =>
      toMap(await query('SELECT num, name, nick, client, overhead FROM projects'), (r) =>
        String(r.num)
      ),
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO projects (num, name, nick, client, overhead)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (num) DO UPDATE
           SET name = EXCLUDED.name,
               client = EXCLUDED.client, overhead = EXCLUDED.overhead`,
        [it.num, it.name, it.nick, it.client, it.overhead]
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
    fields: ['client'],
    label: (it) => `${it.fix} · ${it.client}`,
    load: async () => toMap(await query('SELECT fix, client FROM repairs'), (r) => String(r.fix)),
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO repairs (fix, client) VALUES ($1, $2)
         ON CONFLICT (fix) DO UPDATE SET client = EXCLUDED.client`,
        [it.fix, it.client]
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
  rows: { status: 'new' | 'update' | 'unchanged'; label: string }[];
  errors: RowError[];
}

function parseType(req: { params: { type?: string } }): ImportType {
  const type = req.params.type as ImportType;
  if (!IMPORT_TYPES.includes(type)) throw badRequest('import.unknownType');
  return type;
}

/** Master lists read only their named sheets out of the (large) hours workbook. */
function read(buf: Buffer, sheets?: string[]): Workbook {
  try {
    return readWorkbook(buf, sheets);
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
      rows.push({ status: 'update', label: spec.label(it) });
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

/** Writes a diff's rows + its activity-log entry, inside the caller's transaction. */
async function applyDiff(client: PoolClient, type: ImportType, diff: Diff, userId: number) {
  if (diff.toApply.length === 0) return;
  if (type === 'reports') {
    for (const it of diff.toApply) {
      await client.query(
        `INSERT INTO reports (date, emp_num, proj_num, fix, dept, hours, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [it.date, it.emp_num, it.proj_num, it.fix, it.dept, it.hours, userId]
      );
    }
  } else {
    const spec = SPECS[type];
    for (const it of diff.toApply) await spec.apply(client, it, userId);
  }
  // WP §9.2: one activity-log entry per committed import, in the same
  // transaction as the data it describes.
  await logWith(client, {
    userId,
    action: ACTION.import,
    detail: `${type} · +${diff.counts.new} ~${diff.counts.updated} =${diff.counts.unchanged} !${diff.counts.invalid}`,
    entityKey: type,
  });
}

const PREVIEW_ROWS_CAP = 200;
const ERRORS_CAP = 100;

const previewOf = (type: ImportType, diff: Diff) => ({
  type,
  counts: diff.counts,
  rows: diff.rows.slice(0, PREVIEW_ROWS_CAP),
  rowsTruncated: Math.max(0, diff.rows.length - PREVIEW_ROWS_CAP),
  errors: diff.errors.slice(0, ERRORS_CAP),
  errorsTruncated: Math.max(0, diff.errors.length - ERRORS_CAP),
});

/* ------------------------------------------------- whole-workbook import */

/**
 * The office's hours workbook (דיווח שעות.xlsm) holds all four master lists —
 * employees, departments, projects, repairs — at fixed sheets/columns
 * (lib/importers WORKBOOK_LAYOUT). Uploading a ~34 MB file four times, twice
 * each, is not a workflow, so this pair of routes previews and commits all
 * four from one upload. Commit is one transaction: all four lists or none.
 *
 * Registered before `/:type/...` so `workbook` is not taken for a type name.
 */
async function diffWorkbook(buf: Buffer): Promise<{ type: MasterType; diff: Diff }[]> {
  const wb = read(buf, WORKBOOK_SHEETS);
  const parsed = await Promise.all(MASTER_TYPES.map((type) => parseChecked(type, wb)));
  if (parsed.every(isEmpty)) throw badRequest('import.noRows');
  const out: { type: MasterType; diff: Diff }[] = [];
  for (let i = 0; i < MASTER_TYPES.length; i++) {
    out.push({ type: MASTER_TYPES[i]!, diff: await diffParsed(MASTER_TYPES[i]!, parsed[i]!) });
  }
  return out;
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

importsRouter.post('/workbook/preview', uploadFile, async (req, res) => {
  if (!req.file) throw badRequest('import.noFile');
  const sections = await diffWorkbook(req.file.buffer);
  res.json({
    data: {
      counts: sumCounts(sections),
      sections: sections.map(({ type, diff }) => previewOf(type, diff)),
    },
  });
});

importsRouter.post('/workbook/commit', uploadFile, async (req, res) => {
  if (!req.file) throw badRequest('import.noFile');
  const user = currentUser(req);
  const sections = await diffWorkbook(req.file.buffer);
  const counts = sumCounts(sections);

  if (counts.new + counts.updated > 0) {
    await withTransaction(async (client) => {
      for (const { type, diff } of sections) await applyDiff(client, type, diff, user.id);
    });
  }

  res.json({
    data: {
      applied: counts.new + counts.updated,
      counts,
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
