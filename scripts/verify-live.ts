/**
 * Read-only verification against the real database named by DATABASE_URL.
 *
 *   npm run verify:live
 *
 * Companion to schema:verify (which runs the destructive tests on a throwaway
 * PGlite instance). This one writes nothing, so it is safe to run against
 * production — it is the post-deploy and post-migration check, and part of the
 * WP §12 UAT evidence.
 */
import pg from 'pg';
import 'dotenv/config';

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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 15_000,
  });
  await client.connect();

  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> =>
    (await client.query<T>(sql, params)).rows[0]!;
  const all = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query<T>(sql, params)).rows;

  try {
    const host = new URL(url).host;
    const ver = await one<{ v: string }>('SELECT version() AS v');
    console.log(`Connected to ${host}`);
    console.log(`${ver.v.split(' ').slice(0, 2).join(' ')}\n`);

    // -- schema present -----------------------------------------------------
    console.log('Schema:');
    const mig = await all<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    check('migrations applied', mig.map((m) => m.filename), [
      '001_core_schema.sql',
      '002_reference_data.sql',
      '003_views_and_rules.sql',
    ]);

    const objects = await all<{ name: string; kind: string }>(
      `SELECT c.relname AS name,
              CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' END AS kind
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
        ORDER BY c.relkind, c.relname`
    );
    const tables = objects.filter((o) => o.kind === 'table').map((o) => o.name);
    const views = objects.filter((o) => o.kind === 'view').map((o) => o.name);
    for (const t of [
      'activity_log', 'attendance', 'buckets', 'departments', 'employees',
      'projects', 'reports', 'repairs', 'standard', 'submitted_days', 'users',
    ]) {
      checkTrue(`table ${t} exists`, tables.includes(t));
    }
    for (const v of ['v_reports_full', 'v_standard_by_parent', 'v_orphan_standard_parents']) {
      checkTrue(`view ${v} exists`, views.includes(v));
    }

    const fns = await all<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'fn_%' ORDER BY p.proname`
    );
    // Compared as a sorted set: server collation decides ORDER BY, and this
    // check is about presence, not ordering.
    check(
      'business-rule functions',
      fns.map((f) => f.proname).sort(),
      ['fn_budget_vs_actual', 'fn_bucket_hours', 'fn_coverage', 'fn_dashboard_kpis'].sort()
    );

    // -- seeded data --------------------------------------------------------
    console.log('\nSeeded data (WP §10.5 — verify counts after seeding):');
    const counts = await one<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM employees)   AS employees,
              (SELECT count(*)::int FROM projects)    AS projects,
              (SELECT count(*)::int FROM departments) AS departments,
              (SELECT count(*)::int FROM standard)    AS standard,
              (SELECT count(*)::int FROM repairs)     AS repairs,
              (SELECT count(*)::int FROM reports)     AS reports,
              (SELECT count(*)::int FROM buckets)     AS buckets`
    );
    check('employees', counts.employees, 54);
    check('projects', counts.projects, 50);
    check('departments', counts.departments, 14);
    check('standard boxes', counts.standard, 159);
    check('repairs', counts.repairs, 50);
    check('reports', counts.reports, 89);
    check('buckets', counts.buckets, 10);

    // -- WP §5.1 ------------------------------------------------------------
    console.log('\nWP §5.1 — daily target hours:');
    const targets = await all<{ contractor_kind: string; target: number; n: number }>(
      `SELECT CASE WHEN contractor IS NULL THEN 'internal' ELSE 'subcontractor' END AS contractor_kind,
              effective_target AS target, count(*)::int AS n
         FROM employees WHERE target_hours IS NULL
         GROUP BY 1, 2 ORDER BY 1`
    );
    check(
      'every employee with no override gets 8.5 / 10.5',
      targets.map((t) => [t.contractor_kind, Number(t.target)]),
      [['internal', 8.5], ['subcontractor', 10.5]]
    );
    console.log(`        (${targets.map((t) => `${t.n} ${t.contractor_kind}`).join(', ')})`);

    // -- WP §5.2 ------------------------------------------------------------
    console.log('\nWP §5.2 — bucket mapping:');
    const mapped = await one<{ mapped: number; unmapped: number }>(
      `SELECT count(*) FILTER (WHERE bucket IS NOT NULL)::int AS mapped,
              count(*) FILTER (WHERE bucket IS NULL)::int     AS unmapped
         FROM departments`
    );
    check('13 mapped / 1 unmapped', [mapped.mapped, mapped.unmapped], [13, 1]);

    const badBucket = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM departments d
         LEFT JOIN buckets b ON b.key = d.bucket
        WHERE d.bucket IS NOT NULL AND b.key IS NULL`
    );
    check('no department points at a non-existent bucket', badBucket.n, 0);

    const hours = await one<{ total: number; bucketed: number; nonprod: number }>(
      `SELECT (SELECT sum(hours) FROM reports)::numeric AS total,
              (SELECT COALESCE(sum(hours), 0) FROM fn_bucket_hours())::numeric AS bucketed,
              (SELECT COALESCE(sum(r.hours), 0) FROM reports r
                 JOIN departments d ON d.name = r.dept WHERE d.bucket IS NULL)::numeric AS nonprod`
    );
    checkTrue(
      'bucketed + non-productive = total reported hours',
      Number(hours.bucketed) + Number(hours.nonprod) === Number(hours.total),
      `${hours.bucketed} + ${hours.nonprod} <> ${hours.total}`
    );
    console.log(`        (${hours.total} total, ${hours.bucketed} in buckets, ${hours.nonprod} non-productive)`);

    // -- WP §5.3 / §5.4 -----------------------------------------------------
    console.log('\nWP §5.3/§5.4 — budget control:');
    const bvaMath = await one<{ bad_var: number; bad_util: number; zero_actual: number }>(
      `SELECT count(*) FILTER (WHERE variance <> actual - std_total)::int AS bad_var,
              count(*) FILTER (WHERE std_total > 0
                               AND utilization <> round(actual * 100.0 / std_total, 1))::int AS bad_util,
              count(*) FILTER (WHERE actual <= 0)::int AS zero_actual
         FROM fn_budget_vs_actual()`
    );
    check('variance = actual - standard for every row', bvaMath.bad_var, 0);
    check('utilization = round(actual/standard x 100, 1)', bvaMath.bad_util, 0);
    check('no zero-hours project reported as a saving', bvaMath.zero_actual, 0);

    const overheadLeak = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM fn_budget_vs_actual() b
         JOIN projects p ON p.num = b.proj_num WHERE p.overhead`
    );
    check('overhead projects excluded from the budget table', overheadLeak.n, 0);

    const kpi = await one<{
      total_hours: number; productive_pct: number; overhead_pct: number;
      overruns: number; savings: number; no_standard: number;
    }>('SELECT * FROM fn_dashboard_kpis()');
    checkTrue(
      'productive % + overhead % = 100',
      Number(kpi.productive_pct) + Number(kpi.overhead_pct) === 100,
      `${kpi.productive_pct} + ${kpi.overhead_pct}`
    );
    console.log(
      `        (${kpi.total_hours}h total, ${kpi.productive_pct}% productive, ` +
        `${kpi.overruns} overrun / ${kpi.savings} saving / ${kpi.no_standard} no-standard)`
    );

    // -- WP §5.5 / §5.6 -----------------------------------------------------
    console.log('\nWP §5.5/§5.6 — coverage:');
    const activeN = await one<{ n: number }>(
      'SELECT count(*)::int AS n FROM employees WHERE active'
    );
    const cov = await all<{ status: string; reported: number; target: number; flagged: boolean; clock: number | null }>(
      `SELECT status, reported, target, flagged, clock FROM fn_coverage('2026-07-20')`
    );
    check('one row per active employee', cov.length, activeN.n);
    check(
      'status always agrees with reported vs target',
      cov.filter((r) =>
        Number(r.reported) <= 0
          ? r.status !== 'not_reported'
          : Number(r.reported) >= Number(r.target)
            ? r.status !== 'complete'
            : r.status !== 'partial'
      ).length,
      0
    );
    check('no clock entry => not flagged', cov.filter((r) => r.clock === null && r.flagged).length, 0);
    const byStatus = cov.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`        (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')})`);

    // -- derived read model -------------------------------------------------
    console.log('\nDerived read model:');
    const vrf = await one<{ n: number; unresolved: number }>(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE emp_nick IS NULL OR display_proj_name = ''
                               OR dept_num IS NULL)::int AS unresolved
         FROM v_reports_full`
    );
    check('v_reports_full covers every report', vrf.n, counts.reports);
    check('every row fully resolves', vrf.unresolved, 0);

    // -- referential integrity ---------------------------------------------
    console.log('\nReferential integrity:');
    for (const [label, sql] of [
      ['reports -> employees', `SELECT count(*)::int AS n FROM reports r LEFT JOIN employees e ON e.num = r.emp_num WHERE e.num IS NULL`],
      ['reports -> projects', `SELECT count(*)::int AS n FROM reports r LEFT JOIN projects p ON p.num = r.proj_num WHERE r.proj_num IS NOT NULL AND p.num IS NULL`],
      ['reports -> departments', `SELECT count(*)::int AS n FROM reports r LEFT JOIN departments d ON d.name = r.dept WHERE r.dept IS NOT NULL AND d.name IS NULL`],
      ['reports -> repairs', `SELECT count(*)::int AS n FROM reports r LEFT JOIN repairs x ON x.fix = r.fix WHERE r.fix IS NOT NULL AND x.fix IS NULL`],
    ] as const) {
      const res = await one<{ n: number }>(sql);
      check(`no broken ${label}`, res.n, 0);
    }

    // -- known data-quality debt -------------------------------------------
    console.log('\nKnown data-quality debt (expected, not a failure):');
    const orphans = await all<{ missing_proj_num: number; box_count: number; orphaned_std_hours: number }>(
      'SELECT * FROM v_orphan_standard_parents'
    );
    const boxes = orphans.reduce((s, o) => s + o.box_count, 0);
    const lostHours = orphans.reduce((s, o) => s + Number(o.orphaned_std_hours), 0);
    console.log(
      `        ${orphans.length} missing parent projects, ${boxes} of ${counts.standard} boxes, ` +
        `${lostHours} standard hours invisible to budget-vs-actual`
    );
    console.log('        -> docs/OPEN-QUESTIONS.md #1');
  } finally {
    await client.end();
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nverify:live failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
