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
import { badRequest } from '../lib/errors.ts';
import { IMPORT_TYPES, parseImport, type ImportType, type RowError } from '../lib/importers.ts';
import { tf } from '../lib/messages.ts';
import { MASTER_WRITE, currentUser, requireRole } from '../middleware/auth.ts';
import { gridFromBuffer } from '../lib/xlsx.ts';

export const importsRouter = Router();

importsRouter.use(requireRole(...MASTER_WRITE));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
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

function differs(fields: string[], a: Item, b: Item): boolean {
  return fields.some((f) => norm(a[f]) !== norm(b[f]));
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
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO employees (num, name, nick, active, contractor)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (num) DO UPDATE
           SET name = EXCLUDED.name, nick = EXCLUDED.nick,
               active = EXCLUDED.active, contractor = EXCLUDED.contractor`,
        [it.num, it.name, it.nick, it.active, it.contractor]
      );
    },
  },

  projects: {
    key: (it) => String(it.num),
    fields: ['name', 'nick', 'client', 'overhead'],
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
           SET name = EXCLUDED.name, nick = EXCLUDED.nick,
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
    fields: ['client', 'date', 'model'],
    label: (it) => `${it.fix} · ${it.client}`,
    load: async () =>
      toMap(await query('SELECT fix, client, date, model FROM repairs'), (r) => String(r.fix)),
    apply: async (client, it) => {
      await client.query(
        `INSERT INTO repairs (fix, client, date, model) VALUES ($1, $2, $3, $4)
         ON CONFLICT (fix) DO UPDATE
           SET client = EXCLUDED.client, date = EXCLUDED.date, model = EXCLUDED.model`,
        [it.fix, it.client, it.date, it.model]
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

async function parseAndDiff(type: ImportType, buf: Buffer): Promise<Diff> {
  let grid;
  try {
    grid = gridFromBuffer(buf);
  } catch {
    throw badRequest('import.badFile');
  }

  const parsed = await parseImport(type, grid);
  if (parsed.headerMissing) throw badRequest('import.headerNotFound');
  if (parsed.items.length === 0 && parsed.errors.length === 0) {
    throw badRequest('import.noRows');
  }

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

const PREVIEW_ROWS_CAP = 200;
const ERRORS_CAP = 100;

/* ------------------------------------------------------------------ routes */

importsRouter.post('/:type/preview', uploadFile, async (req, res) => {
  const type = parseType(req);
  if (!req.file) throw badRequest('import.noFile');

  const diff = await parseAndDiff(type, req.file.buffer);
  res.json({
    data: {
      type,
      counts: diff.counts,
      rows: diff.rows.slice(0, PREVIEW_ROWS_CAP),
      rowsTruncated: Math.max(0, diff.rows.length - PREVIEW_ROWS_CAP),
      errors: diff.errors.slice(0, ERRORS_CAP),
      errorsTruncated: Math.max(0, diff.errors.length - ERRORS_CAP),
    },
  });
});

importsRouter.post('/:type/commit', uploadFile, async (req, res) => {
  const type = parseType(req);
  if (!req.file) throw badRequest('import.noFile');
  const user = currentUser(req);

  const diff = await parseAndDiff(type, req.file.buffer);

  if (diff.toApply.length > 0) {
    await withTransaction(async (client) => {
      if (type === 'reports') {
        for (const it of diff.toApply) {
          await client.query(
            `INSERT INTO reports (date, emp_num, proj_num, fix, dept, hours, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [it.date, it.emp_num, it.proj_num, it.fix, it.dept, it.hours, user.id]
          );
        }
      } else {
        const spec = SPECS[type];
        for (const it of diff.toApply) await spec.apply(client, it, user.id);
      }
      // WP §9.2: one activity-log entry per committed import, in the same
      // transaction as the data it describes.
      await logWith(client, {
        userId: user.id,
        action: ACTION.import,
        detail: `${type} · +${diff.counts.new} ~${diff.counts.updated} =${diff.counts.unchanged} !${diff.counts.invalid}`,
        entityKey: type,
      });
    });
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

