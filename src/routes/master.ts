/**
 * Master-data endpoints (WP §7.2): employees, projects, departments, standard
 * hours, repairs.
 *
 * Reading requires only authentication — the reporting grid's autocomplete needs
 * it for every role. Writing requires manager or admin (WP §8).
 */
import { Router } from 'express';
import { z } from 'zod';
import { createCrudRouter } from '../lib/crud.ts';
import { ENTITY, t } from '../lib/messages.ts';
import { MASTER_WRITE } from '../middleware/auth.ts';

/** Trimmed, non-empty text. Hebrew passes through untouched. */
const text = (max = 200) =>
  z.string().transform((s) => s.trim()).pipe(z.string().min(1, t('field.required')).max(max));

const optionalText = (max = 200) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(max))
    .nullish()
    .transform((v) => (v === '' || v === undefined ? null : v));

const businessKey = z.coerce.number().int().positive(t('field.positiveNumber'));

export const masterRouter = Router();

/* ----------------------------------------------------------- employees */
const employeeCreate = z.object({
  num: businessKey,
  name: text(120),
  nick: text(60),
  active: z.coerce.boolean().default(true),
  contractor: optionalText(80),
  // WP §5.1: null means "use the default for this employee type".
  target_hours: z.coerce.number().positive().max(24).nullish().transform((v) => v ?? null),
});

masterRouter.use(
  '/employees',
  createCrudRouter<{ num: number; name: string; nick: string }>({
    table: 'employees',
    key: 'num',
    keyKind: 'int',
    select: ['num', 'name', 'nick', 'active', 'contractor', 'target_hours', 'effective_target'],
    insertable: ['num', 'name', 'nick', 'active', 'contractor', 'target_hours'],
    // num is the business key and is referenced by reports — not editable.
    updatable: ['name', 'nick', 'active', 'contractor', 'target_hours'],
    createSchema: employeeCreate,
    updateSchema: employeeCreate.partial().omit({ num: true }),
    writeRoles: MASTER_WRITE,
    entity: ENTITY.employee,
    label: (r) => `${r.name} (${r.num})`,
    orderBy: 'name',
    listFilter: (q) =>
      q.active === 'true'
        ? { sql: 'active', values: [] }
        : q.active === 'false'
          ? { sql: 'NOT active', values: [] }
          : { sql: '', values: [] },
  })
);

/* ------------------------------------------------------------ projects */
const projectCreate = z.object({
  num: businessKey,
  name: text(300),
  nick: text(60),
  client: optionalText(150).transform((v) => v ?? '—'),
  overhead: z.coerce.boolean().default(false),
});

masterRouter.use(
  '/projects',
  createCrudRouter<{ num: number; name: string }>({
    table: 'projects',
    key: 'num',
    keyKind: 'int',
    select: ['num', 'name', 'nick', 'client', 'overhead'],
    insertable: ['num', 'name', 'nick', 'client', 'overhead'],
    updatable: ['name', 'nick', 'client', 'overhead'],
    createSchema: projectCreate,
    updateSchema: projectCreate.partial().omit({ num: true }),
    writeRoles: MASTER_WRITE,
    entity: ENTITY.project,
    label: (r) => `${r.name} (${r.num})`,
    orderBy: 'overhead, num',
    listFilter: (q) =>
      q.overhead === 'true'
        ? { sql: 'overhead', values: [] }
        : q.overhead === 'false'
          ? { sql: 'NOT overhead', values: [] }
          : { sql: '', values: [] },
  })
);

/* --------------------------------------------------------- departments */
// The key is the name. reports.dept has ON UPDATE CASCADE, so renaming a
// department carries its reports with it — the prototype had to delete and
// re-insert to achieve the same thing.
const departmentCreate = z.object({
  name: text(80),
  num: z.coerce.number().int().nullish().transform((v) => v ?? null),
  bucket: z
    .enum(['pah', 'misgarot', 'hazraka', 'panelim', 'hadbaka', 'ritum', 'dlatot', 'hashmal', 'psei', 'hashlamot'])
    .nullish()
    .transform((v) => v ?? null),
});

masterRouter.use(
  '/departments',
  createCrudRouter<{ name: string }>({
    table: 'departments',
    key: 'name',
    keyKind: 'text',
    select: ['name', 'num', 'bucket'],
    insertable: ['name', 'num', 'bucket'],
    updatable: ['name', 'num', 'bucket'],
    createSchema: departmentCreate,
    updateSchema: departmentCreate.partial(),
    writeRoles: MASTER_WRITE,
    entity: ENTITY.department,
    label: (r) => r.name,
    orderBy: 'num NULLS LAST, name',
  })
);

/* ------------------------------------------------------ standard hours */
const BUCKET_COLUMNS = [
  'pah', 'misgarot', 'hazraka', 'panelim', 'hadbaka',
  'ritum', 'dlatot', 'hashmal', 'psei', 'hashlamot',
] as const;

const bucketHours = z.coerce.number().int().min(0).max(100_000).default(0);

const standardCreate = z.object({
  box: businessKey,
  name: optionalText(300).transform((v) => v ?? ''),
  // Intentionally NOT validated against projects: 43 parent values in the
  // existing data reference projects that do not exist. See OPEN-QUESTIONS #1 —
  // rejecting them here would block editing the very rows that need fixing.
  parent: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  total: z.coerce.number().int().min(0).max(1_000_000).default(0),
  ...Object.fromEntries(BUCKET_COLUMNS.map((b) => [b, bucketHours])),
});

masterRouter.use(
  '/standard',
  createCrudRouter<{ box: number; name: string; total: number }>({
    table: 'standard',
    key: 'box',
    keyKind: 'int',
    select: ['box', 'name', 'parent', 'total', ...BUCKET_COLUMNS],
    insertable: ['box', 'name', 'parent', 'total', ...BUCKET_COLUMNS],
    updatable: ['name', 'parent', 'total', ...BUCKET_COLUMNS],
    createSchema: standardCreate,
    updateSchema: standardCreate.partial().omit({ box: true }),
    writeRoles: MASTER_WRITE,
    entity: ENTITY.standard,
    label: (r) => `box ${r.box} · standard ${r.total}`,
    orderBy: 'parent NULLS LAST, box',
    listFilter: (q) =>
      q.parent ? { sql: 'parent = $1', values: [Number(q.parent)] } : { sql: '', values: [] },
  })
);

/* ------------------------------------------------------------- repairs */
const repairCreate = z.object({
  fix: businessKey,
  client: optionalText(150).transform((v) => v ?? ''),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, t('field.dateFormat'))
    .nullish()
    .transform((v) => v ?? null),
  model: optionalText(80),
});

masterRouter.use(
  '/repairs',
  createCrudRouter<{ fix: number; client: string }>({
    table: 'repairs',
    key: 'fix',
    keyKind: 'int',
    select: ['fix', 'client', 'date', 'model'],
    insertable: ['fix', 'client', 'date', 'model'],
    updatable: ['client', 'date', 'model'],
    createSchema: repairCreate,
    updateSchema: repairCreate.partial().omit({ fix: true }),
    writeRoles: MASTER_WRITE,
    entity: ENTITY.repair,
    label: (r) => `${r.fix}${r.client ? ` · ${r.client}` : ''}`,
    orderBy: 'fix DESC',
  })
);

/* -------------------------------------------------------------- buckets */
// Read-only reference data — the 10 costing buckets. Needed by the dashboard
// chart and the department editor.
masterRouter.get('/buckets', async (_req, res) => {
  const { query } = await import('../lib/db.ts');
  const rows = await query('SELECT key, label_he, sort_order FROM buckets ORDER BY sort_order');
  res.json({ data: rows, count: rows.length });
});
