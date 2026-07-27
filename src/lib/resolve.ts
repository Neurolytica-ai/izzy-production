/**
 * WP §5.7 — derived-field resolution.
 *
 * The reporting grid is typed, not picked: a user types an employee nickname and
 * a project nickname, and the numeric keys and display fields are derived from
 * master data. WP §6.1 requires this to happen server-side ("All derived values
 * are computed server-side; the client only displays them"), so the client can
 * never invent a project number.
 *
 * Matching mirrors the prototype's blur handler (setupAC, :484-489): an exact
 * nickname or full-name match resolves; anything else is left unresolved and
 * reported as "לא זוהה" rather than guessed at.
 */
import { queryOne } from './db.ts';

export interface ResolvedEmployee {
  emp_num: number;
  emp_nick: string;
  emp_name: string;
  contractor: string | null;
  effective_target: number;
}

export interface ResolvedProject {
  proj_num: number;
  proj_nick: string;
  proj_name: string;
  client: string;
  overhead: boolean;
}

export interface ResolvedDepartment {
  dept: string;
  dept_num: number | null;
  bucket: string | null;
}

/**
 * Resolves an employee by nickname, full name or number.
 *
 * Unlike the prototype (which searches activeEmps() only) inactive employees are
 * matched too, because historical rows and bulk imports legitimately reference
 * people who have since left. Callers that must exclude them can check
 * `active` — but silently failing to resolve a departed employee, as the
 * prototype does, produces report rows with a null employee number.
 */
export async function resolveEmployee(input: string | number): Promise<ResolvedEmployee | null> {
  const raw = String(input).trim();
  if (!raw) return null;

  const asNum = Number(raw);
  const byNumber = Number.isInteger(asNum) && raw !== '';

  return queryOne<ResolvedEmployee>(
    `SELECT num AS emp_num, nick AS emp_nick, name AS emp_name, contractor, effective_target
       FROM employees
      WHERE ($2::boolean AND num = $3::integer) OR nick = $1 OR name = $1
      ORDER BY (num = $3::integer) DESC, (nick = $1) DESC
      LIMIT 1`,
    [raw, byNumber, byNumber ? asNum : null]
  );
}

export async function resolveProject(input: string | number): Promise<ResolvedProject | null> {
  const raw = String(input).trim();
  if (!raw) return null;

  const asNum = Number(raw);
  const byNumber = Number.isInteger(asNum) && raw !== '';

  return queryOne<ResolvedProject>(
    `SELECT num AS proj_num, nick AS proj_nick, name AS proj_name, client, overhead
       FROM projects
      WHERE ($2::boolean AND num = $3::integer) OR nick = $1 OR name = $1
      ORDER BY (num = $3::integer) DESC, (nick = $1) DESC
      LIMIT 1`,
    [raw, byNumber, byNumber ? asNum : null]
  );
}

export async function resolveDepartment(input: string): Promise<ResolvedDepartment | null> {
  const raw = String(input).trim();
  if (!raw) return null;

  // Whitespace-insensitive comparison on purpose. The source data contains
  // "חשמל  סולארי" with a double space (OPEN-QUESTIONS #2); without this, a
  // single-spaced entry would fail to resolve and its hours would fall out of the
  // dashboard silently.
  return queryOne<ResolvedDepartment>(
    `SELECT name AS dept, num AS dept_num, bucket
       FROM departments
      WHERE name = $1
         OR regexp_replace(name, '\\s+', ' ', 'g') = regexp_replace($1, '\\s+', ' ', 'g')
      ORDER BY (name = $1) DESC
      LIMIT 1`,
    [raw]
  );
}

export async function resolveRepair(
  input: string | number
): Promise<{ fix: number; client: string; date: string | null } | null> {
  const asNum = Number(String(input).trim());
  if (!Number.isInteger(asNum)) return null;
  return queryOne('SELECT fix, client, date FROM repairs WHERE fix = $1', [asNum]);
}

export interface ResolveRowInput {
  emp?: string | number | null;
  proj?: string | number | null;
  dept?: string | null;
  fix?: string | number | null;
}

export interface ResolvedRow {
  employee: ResolvedEmployee | null;
  project: ResolvedProject | null;
  department: ResolvedDepartment | null;
  repair: { fix: number; client: string; date: string | null } | null;
  /** Fields that were supplied but could not be matched — the grid's "לא זוהה". */
  unresolved: string[];
}

/**
 * Resolves a whole grid row in one call, so typing a row costs one request
 * rather than four.
 */
export async function resolveRow(input: ResolveRowInput): Promise<ResolvedRow> {
  const [employee, project, department, repair] = await Promise.all([
    input.emp ? resolveEmployee(input.emp) : Promise.resolve(null),
    input.proj ? resolveProject(input.proj) : Promise.resolve(null),
    input.dept ? resolveDepartment(input.dept) : Promise.resolve(null),
    input.fix ? resolveRepair(input.fix) : Promise.resolve(null),
  ]);

  const unresolved: string[] = [];
  if (input.emp && !employee) unresolved.push('emp');
  if (input.proj && !project) unresolved.push('proj');
  if (input.dept && !department) unresolved.push('dept');
  if (input.fix && !repair) unresolved.push('fix');

  return { employee, project, department, repair, unresolved };
}
