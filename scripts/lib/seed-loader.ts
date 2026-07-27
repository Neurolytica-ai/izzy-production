/**
 * Shared seed-loading logic, written against a minimal query interface so it
 * runs unchanged against a real Postgres/Supabase connection (load-seed.ts) and
 * against the in-process PGlite instance used for schema verification
 * (verify-schema.ts). One code path, so what CI checks is what production runs.
 */

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface SeedFile {
  _meta: { counts: Record<string, number>; notes: string[] };
  employees: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  departments: Record<string, unknown>[];
  standard: Record<string, unknown>[];
  repairs: Record<string, unknown>[];
  reports: Record<string, unknown>[];
}

/**
 * Multi-row upsert. Postgres caps a statement at 65535 bound parameters, so
 * chunk to stay well clear of it — 159 standard rows x 14 columns is fine, a
 * few years of report history would not be.
 */
async function upsert(
  db: Queryable,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  conflictTarget: string | null
): Promise<number> {
  if (rows.length === 0) return 0;

  const maxParams = 30_000;
  const chunkSize = Math.max(1, Math.floor(maxParams / columns.length));
  let written = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(row[col] ?? null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const quoted = columns.map((c) => `"${c}"`).join(', ');
    let sql = `INSERT INTO ${table} (${quoted}) VALUES ${tuples.join(', ')}`;

    if (conflictTarget) {
      const updatable = columns.filter((c) => c !== conflictTarget);
      sql +=
        updatable.length > 0
          ? ` ON CONFLICT ("${conflictTarget}") DO UPDATE SET ` +
            updatable.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
          : ` ON CONFLICT ("${conflictTarget}") DO NOTHING`;
    }

    await db.query(sql, params);
    written += chunk.length;
  }
  return written;
}

export interface LoadResult {
  employees: number;
  projects: number;
  departments: number;
  repairs: number;
  standard: number;
  reports: number;
}

/**
 * Loads a seed file. Master data upserts (safe to re-run). Reports are only
 * inserted when the table is empty — re-running would otherwise duplicate every
 * historical row, which is exactly the bug the prototype's bulk report import
 * has (it always appends, with no dedup).
 */
export async function loadSeed(
  db: Queryable,
  seed: SeedFile,
  opts: { includeReports?: boolean } = {}
): Promise<LoadResult> {
  const result: LoadResult = {
    employees: 0,
    projects: 0,
    departments: 0,
    repairs: 0,
    standard: 0,
    reports: 0,
  };

  // Order matters: reports reference all four master tables.
  result.employees = await upsert(
    db,
    'employees',
    ['num', 'name', 'nick', 'active', 'contractor', 'target_hours'],
    seed.employees,
    'num'
  );

  result.projects = await upsert(
    db,
    'projects',
    ['num', 'name', 'nick', 'client', 'overhead'],
    seed.projects,
    'num'
  );

  result.departments = await upsert(
    db,
    'departments',
    ['name', 'num', 'bucket'],
    seed.departments,
    'name'
  );

  result.repairs = await upsert(
    db,
    'repairs',
    ['fix', 'client', 'date', 'model'],
    seed.repairs,
    'fix'
  );

  result.standard = await upsert(
    db,
    'standard',
    [
      'box',
      'name',
      'parent',
      'total',
      'pah',
      'misgarot',
      'hazraka',
      'panelim',
      'hadbaka',
      'ritum',
      'dlatot',
      'hashmal',
      'psei',
      'hashlamot',
    ],
    seed.standard,
    'box'
  );

  if (opts.includeReports !== false) {
    const existing = await db.query('SELECT count(*)::int AS n FROM reports');
    const n = (existing.rows[0] as { n: number } | undefined)?.n ?? 0;
    if (n === 0) {
      result.reports = await upsert(
        db,
        'reports',
        ['date', 'emp_num', 'proj_num', 'fix', 'dept', 'hours'],
        seed.reports,
        null
      );
    }
  }

  return result;
}
