/**
 * Runs the whole schema against a throwaway in-process Postgres (PGlite — real
 * Postgres compiled to WASM, no Docker, no server), loads the extracted seed
 * data, and asserts the WP §5 business rules actually hold.
 *
 * This is the safety net for the Supabase deployment: if this passes, the
 * migrations apply cleanly and the rules compute correctly before anything
 * touches a real database.
 *
 *   npm run schema:verify
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { loadSeed, type SeedFile, type Queryable } from './lib/seed-loader.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, '..', 'db', 'migrations');
const POST_SEED = path.join(HERE, '..', 'db', 'post-seed');
const SEED_JSON = path.join(HERE, '..', 'db', 'seed', 'seed.json');

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function checkTrue(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

/** Asserts a statement is rejected by the database. */
async function expectRejected(db: Queryable, label: string, sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    failed++;
    console.log(`  FAIL  ${label}\n          statement was ACCEPTED but should have been rejected`);
  } catch {
    passed++;
    console.log(`  PASS  ${label}`);
  }
}

async function one<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query(sql, params);
  return res.rows[0] as T;
}

async function main() {
  const db = new PGlite();
  const q: Queryable = {
    query: (sql, params) => db.query(sql, params) as Promise<{ rows: unknown[] }>,
  };

  console.log('Postgres (PGlite):', (await one<{ v: string }>(q, 'SELECT version() AS v')).v.split(',')[0]);

  // -- migrations ------------------------------------------------------------
  console.log('\nApplying migrations:');
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await db.exec(await readFile(path.join(MIGRATIONS, f), 'utf8'));
    console.log(`  ok    ${f}`);
  }

  // -- seed -----------------------------------------------------------------
  const seed = JSON.parse(await readFile(SEED_JSON, 'utf8')) as SeedFile;
  const loaded = await loadSeed(q, seed);
  console.log('\nSeed loaded:', JSON.stringify(loaded));

  // Re-running must not duplicate anything — the property the prototype's
  // bulk import lacks and WP §9.2 requires.
  const before = await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM reports');
  await loadSeed(q, seed);
  const after = await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM reports');

  console.log('\nRow counts:');
  check('employees', (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM employees')).n, 54);
  check('projects', (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM projects')).n, 50);
  check('departments', (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM departments')).n, 14);
  check('standard', (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM standard')).n, 159);
  check('repairs', (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM repairs')).n, 50);
  check('reports', (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM reports')).n, 89);
  check('buckets (from migration 002)', (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM buckets')).n, 10);
  check('seed load is idempotent', after.n, before.n);

  // -- WP §5.1 daily target -------------------------------------------------
  console.log('\nWP §5.1 — daily target hours:');
  const internal = await one<{ t: string }>(
    q,
    'SELECT effective_target::text AS t FROM employees WHERE contractor IS NULL LIMIT 1'
  );
  check('internal employee target = 8.5', internal.t, '8.50');

  const contractor = await one<{ t: string }>(
    q,
    'SELECT effective_target::text AS t FROM employees WHERE contractor IS NOT NULL LIMIT 1'
  );
  check('subcontractor target = 10.5', contractor.t, '10.50');

  await db.query('UPDATE employees SET target_hours = 7.25 WHERE num = $1', [221]);
  const overridden = await one<{ t: string }>(
    q,
    'SELECT effective_target::text AS t FROM employees WHERE num = 221'
  );
  check('explicit override wins', overridden.t, '7.25');
  await db.query('UPDATE employees SET target_hours = NULL WHERE num = $1', [221]);

  // -- WP §5.2 bucket mapping ----------------------------------------------
  console.log('\nWP §5.2 — department to bucket mapping:');
  const mappedDepts = await one<{ n: number }>(
    q,
    'SELECT count(*)::int AS n FROM departments WHERE bucket IS NOT NULL'
  );
  check('13 of 14 departments map to a bucket', mappedDepts.n, 13);
  const nonProd = await one<{ name: string }>(
    q,
    'SELECT name FROM departments WHERE bucket IS NULL'
  );
  check('the unmapped one is לא יצרני', nonProd.name, 'לא יצרני');

  // Every reported hour should land in a bucket except non-productive ones.
  const totalHours = await one<{ h: string }>(q, 'SELECT sum(hours)::text AS h FROM reports');
  const bucketed = await one<{ h: string }>(
    q,
    'SELECT COALESCE(sum(hours), 0)::text AS h FROM fn_bucket_hours()'
  );
  const nonProdHours = await one<{ h: string }>(
    q,
    `SELECT COALESCE(sum(r.hours), 0)::text AS h
       FROM reports r JOIN departments d ON d.name = r.dept WHERE d.bucket IS NULL`
  );
  checkTrue(
    'bucketed + non-productive hours = total reported',
    Number(bucketed.h) + Number(nonProdHours.h) === Number(totalHours.h),
    `${bucketed.h} + ${nonProdHours.h} <> ${totalHours.h}`
  );

  // -- WP §5.3 budget control ----------------------------------------------
  console.log('\nWP §5.3 — standard vs actual:');
  const bva = (await q.query('SELECT * FROM fn_budget_vs_actual()')).rows as {
    proj_num: number;
    std_total: number;
    actual: string;
    variance: string;
    utilization: string | null;
    state: string;
  }[];
  checkTrue('budget-vs-actual returns rows', bva.length > 0, `got ${bva.length}`);
  checkTrue(
    'variance = actual - standard for every row',
    bva.every((r) => Number(r.variance) === Number(r.actual) - r.std_total)
  );
  // Checked in SQL, not JS: utilization is round(...,1) over exact numerics, and
  // comparing that in JS floats gives false failures (11.8 - 11.75 is
  // 0.05000000000000071, not 0.05 — project 24459 is exactly that case).
  const utilMismatch = await one<{ n: number }>(
    q,
    `SELECT count(*)::int AS n FROM fn_budget_vs_actual()
       WHERE std_total > 0 AND utilization <> round(actual * 100.0 / std_total, 1)`
  );
  check('utilization = round(actual / standard x 100, 1)', utilMismatch.n, 0);

  const varMismatch = await one<{ n: number }>(
    q,
    `SELECT count(*)::int AS n FROM fn_budget_vs_actual() WHERE variance <> actual - std_total`
  );
  check('variance = actual - standard (exact, in SQL)', varMismatch.n, 0);
  checkTrue(
    'a project with a standard but no hours is not reported as a saving',
    bva.every((r) => Number(r.actual) > 0),
    `rows with zero actual hours: ${bva.filter((r) => Number(r.actual) === 0).map((r) => r.proj_num).join(', ')}`
  );
  checkTrue(
    'state matches the sign of variance',
    bva.every(
      (r) =>
        (r.state === 'overrun' && Number(r.variance) > 0) ||
        (r.state === 'saving' && Number(r.variance) < 0) ||
        (r.state === 'on_target' && Number(r.variance) === 0) ||
        r.state === 'no_standard'
    )
  );
  const overheadInBva = await one<{ n: number }>(
    q,
    `SELECT count(*)::int AS n FROM fn_budget_vs_actual() b
       JOIN projects p ON p.num = b.proj_num WHERE p.overhead`
  );
  check('WP §5.4 — overhead projects excluded from budget table', overheadInBva.n, 0);

  // WP §6.4 acceptance: projects with no standard are shown, not dropped.
  checkTrue(
    'projects with no standard surface as state=no_standard',
    bva.some((r) => r.state === 'no_standard'),
    'no such row — the dashboard would be hiding them, like the prototype does'
  );

  // -- WP §5.5 / §5.6 coverage ---------------------------------------------
  console.log('\nWP §5.5/§5.6 — coverage and attendance variance:');
  const activeCount = await one<{ n: number }>(
    q,
    'SELECT count(*)::int AS n FROM employees WHERE active'
  );
  const cov = (await q.query('SELECT * FROM fn_coverage($1)', ['2026-07-20'])).rows as {
    emp_num: number;
    reported: string;
    target: string;
    status: string;
    clock: string | null;
    variance: string | null;
    flagged: boolean;
  }[];
  check('one row per active employee', cov.length, activeCount.n);
  checkTrue(
    'status follows reported vs target',
    cov.every((r) =>
      Number(r.reported) <= 0
        ? r.status === 'not_reported'
        : Number(r.reported) >= Number(r.target)
          ? r.status === 'complete'
          : r.status === 'partial'
    )
  );
  checkTrue('no clock entry => variance NULL, not flagged', cov.every((r) => r.clock !== null || (r.variance === null && !r.flagged)));

  // Attendance variance: seed a clock entry 1.5h above reported -> flagged.
  const someEmp = cov.find((r) => Number(r.reported) > 0)!;
  await db.query(
    `INSERT INTO attendance (date, emp_num, hours, source) VALUES ($1, $2, $3, 'import')
       ON CONFLICT (date, emp_num) DO UPDATE SET hours = EXCLUDED.hours`,
    ['2026-07-20', someEmp.emp_num, Number(someEmp.reported) + 1.5]
  );
  const flagged = (await q.query('SELECT * FROM fn_coverage($1) WHERE emp_num = $2', [
    '2026-07-20',
    someEmp.emp_num,
  ])).rows[0] as { variance: string; flagged: boolean };
  check('variance of +1.5h is flagged', [flagged.variance, flagged.flagged], ['1.50', true]);

  await db.query('UPDATE attendance SET hours = $1 WHERE date = $2 AND emp_num = $3', [
    Number(someEmp.reported) + 0.5,
    '2026-07-20',
    someEmp.emp_num,
  ]);
  const notFlagged = (await q.query('SELECT * FROM fn_coverage($1) WHERE emp_num = $2', [
    '2026-07-20',
    someEmp.emp_num,
  ])).rows[0] as { flagged: boolean };
  check('variance of +0.5h is NOT flagged', notFlagged.flagged, false);

  // Exactly-1.0 is the boundary: WP §5.5 says "exceeds 1.0", so 1.0 is fine.
  await db.query('UPDATE attendance SET hours = $1 WHERE date = $2 AND emp_num = $3', [
    Number(someEmp.reported) + 1.0,
    '2026-07-20',
    someEmp.emp_num,
  ]);
  const boundary = (await q.query('SELECT * FROM fn_coverage($1) WHERE emp_num = $2', [
    '2026-07-20',
    someEmp.emp_num,
  ])).rows[0] as { flagged: boolean };
  check('variance of exactly 1.0h is NOT flagged (">" not ">=")', boundary.flagged, false);

  // -- constraints ----------------------------------------------------------
  console.log('\nSchema constraints:');
  await expectRejected(
    q,
    'report with neither project nor repair is rejected',
    `INSERT INTO reports (date, emp_num, proj_num, fix, dept, hours)
       VALUES ('2026-07-20', 221, NULL, NULL, 'ריתום', 3)`
  );
  await expectRejected(
    q,
    'report with zero hours is rejected',
    `INSERT INTO reports (date, emp_num, proj_num, dept, hours)
       VALUES ('2026-07-20', 221, 24334, 'ריתום', 0)`
  );
  await expectRejected(
    q,
    'report referencing an unknown employee is rejected',
    `INSERT INTO reports (date, emp_num, proj_num, dept, hours)
       VALUES ('2026-07-20', 999999, 24334, 'ריתום', 3)`
  );
  await expectRejected(
    q,
    'report referencing an unknown department is rejected',
    `INSERT INTO reports (date, emp_num, proj_num, dept, hours)
       VALUES ('2026-07-20', 221, 24334, 'מחלקה שלא קיימת', 3)`
  );
  await expectRejected(
    q,
    'deleting an employee with reports is blocked (WP §4.10)',
    'DELETE FROM employees WHERE num = 221'
  );
  await expectRejected(
    q,
    'duplicate username is rejected',
    `INSERT INTO users (username, password_hash, display_name, role)
       VALUES ('dup', 'x', 'A', 'admin'), ('dup', 'y', 'B', 'admin')`
  );
  await expectRejected(
    q,
    'invalid role is rejected by the enum',
    `INSERT INTO users (username, password_hash, display_name, role)
       VALUES ('u1', 'x', 'A', 'superuser')`
  );

  // -- derived read model ---------------------------------------------------
  console.log('\nDerived read model:');
  const vr = await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM v_reports_full');
  check('v_reports_full covers every report', vr.n, 89);
  const unresolved = await one<{ n: number }>(
    q,
    `SELECT count(*)::int AS n FROM v_reports_full
       WHERE emp_nick IS NULL OR display_proj_name = '' OR dept_num IS NULL`
  );
  check('every row resolves employee, project name and dept code', unresolved.n, 0);

  // A repair row must render as "תיקון <n> · <client>" with no project.
  await db.query(
    `INSERT INTO reports (date, emp_num, proj_num, fix, dept, hours)
       VALUES ('2026-07-21', 221, NULL, 16989, 'ריתום', 4)`
  );
  const repairRow = await one<{ display_proj_name: string }>(
    q,
    `SELECT display_proj_name FROM v_reports_full WHERE fix = 16989`
  );
  checkTrue(
    'repair-only row renders as "תיקון <n> · <client>"',
    repairRow.display_proj_name.startsWith('תיקון 16989 · '),
    `got ${JSON.stringify(repairRow.display_proj_name)}`
  );
  await db.query('DELETE FROM reports WHERE fix = 16989');

  // -- data quality ---------------------------------------------------------
  console.log('\nData quality:');
  const orphans = (await q.query('SELECT * FROM v_orphan_standard_parents')).rows as {
    missing_proj_num: number;
    box_count: number;
  }[];
  check('v_orphan_standard_parents reports 43 missing parents', orphans.length, 43);
  const orphanBoxes = orphans.reduce((s, o) => s + o.box_count, 0);
  console.log(
    `        (${orphanBoxes} of 159 boxes roll up to a project that does not exist — ` +
      `invisible on the dashboard)`
  );

  // -- post-seed FK ---------------------------------------------------------
  console.log('\nPost-seed constraint (db/post-seed/001_standard_parent_fk.sql):');
  await db.exec(await readFile(path.join(POST_SEED, '001_standard_parent_fk.sql'), 'utf8'));
  passed++;
  console.log('  PASS  NOT VALID FK applies cleanly over the 43 existing orphans');
  await expectRejected(
    q,
    'but NEW rows with a bad parent are now rejected',
    `INSERT INTO standard (box, name, parent, total) VALUES (999999, 'x', 888888, 10)`
  );
  await expectRejected(
    q,
    'VALIDATE still fails while orphans remain (as designed)',
    'ALTER TABLE standard VALIDATE CONSTRAINT standard_parent_fkey'
  );

  await db.close();

  console.log(`\n${'='.repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nverify-schema crashed:', err);
  process.exit(1);
});
