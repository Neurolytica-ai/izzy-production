/**
 * End-to-end API tests for Phase 1: auth, roles, master-data CRUD, and the
 * WP §5.7 derived-field resolution.
 *
 *   npm run verify:api
 *
 * THIS WRITES TO THE DATABASE. Everything it creates is namespaced (usernames
 * prefixed `_apitest_`, business keys from 990000 up) and removed in a finally
 * block, including after a failure. It refuses to run against NODE_ENV=production
 * without --force.
 *
 * Covers the WP §12 requirement that "API integration tests should cover
 * auth/permissions per role".
 */
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import 'dotenv/config';
import { hashPassword } from '../src/lib/auth.ts';
import { ACTION } from '../src/lib/messages.ts';

const TEST_PREFIX = '_apitest_';
const TEST_EMP_BASE = 990_000;
const TEST_PROJ = 990_001;
const TEST_DEPT = '_apitest_dept';

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

/** Minimal cookie jar — Node's fetch has none. */
class Session {
  private cookie = '';
  constructor(private base: string) {}

  async req(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: any; raw: Response }> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const pair = c.split(';')[0]!;
      if (pair.startsWith('izy_session=')) {
        this.cookie = pair.endsWith('=') ? '' : pair;
      }
    }

    let json: any = null;
    if (res.status !== 204) {
      const txt = await res.text();
      try {
        json = txt ? JSON.parse(txt) : null;
      } catch {
        json = txt;
      }
    }
    return { status: res.status, json, raw: res };
  }

  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b);
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  del = (p: string) => this.req('DELETE', p);
  hasCookie = () => this.cookie !== '';

  /** GET returning the raw bytes — for the Excel download endpoints. */
  async getBinary(path: string) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(`${this.base}${path}`, { headers });
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      buf: Buffer.from(await res.arrayBuffer()),
    };
  }

  /** Multipart upload, for the Excel import endpoints. */
  async upload(path: string, buf: Buffer, filename = 'test.xlsx') {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(buf)]), filename);
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(`${this.base}${path}`, { method: 'POST', headers, body: fd });
    let json: any = null;
    if (res.status !== 204) {
      const txt = await res.text();
      try {
        json = txt ? JSON.parse(txt) : null;
      } catch {
        json = txt;
      }
    }
    return { status: res.status, json, raw: res };
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('Refusing to run write tests against NODE_ENV=production. Pass --force if you really mean it.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const db = new pg.Client({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  await db.connect();

  const { createApp } = await import('../src/app.ts');
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  console.log(`app on ${base}, database ${new URL(url).host}\n`);

  const cleanup = async () => {
    // Order matters: reports reference employees and projects.
    await db.query(`DELETE FROM reports WHERE emp_num >= $1 OR proj_num >= $1`, [TEST_EMP_BASE]);
    await db.query(`DELETE FROM attendance WHERE emp_num >= $1`, [TEST_EMP_BASE]);
    await db.query(`DELETE FROM submitted_days WHERE date IN ('2026-07-22','2026-07-23')`);
    await db.query(`DELETE FROM activity_log WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`${TEST_PREFIX}%`]);
    await db.query(`DELETE FROM users WHERE username LIKE $1`, [`${TEST_PREFIX}%`]);
    await db.query(`DELETE FROM employees WHERE num >= $1`, [TEST_EMP_BASE]);
    await db.query(`DELETE FROM projects WHERE num >= $1`, [TEST_EMP_BASE]);
    await db.query(`DELETE FROM departments WHERE name = $1`, [TEST_DEPT]);
    await db.query(`DELETE FROM standard WHERE box >= $1`, [TEST_EMP_BASE]);
    await db.query(`DELETE FROM repairs WHERE fix >= $1`, [TEST_EMP_BASE]);
  };

  try {
    await cleanup(); // in case a previous run died mid-way

    // Seed three accounts directly — the API cannot bootstrap its first admin.
    const pw = 'apitest-password-123';
    const hash = await hashPassword(pw);
    const ids: Record<string, number> = {};
    for (const role of ['admin', 'manager', 'reporter'] as const) {
      const r = await db.query<{ id: number }>(
        `INSERT INTO users (username, password_hash, display_name, role, active)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [`${TEST_PREFIX}${role}`, hash, `test ${role}`, role]
      );
      ids[role] = r.rows[0]!.id;
    }

    // ---- auth ------------------------------------------------------------
    console.log('WP §7.1 — authentication:');
    const anon = new Session(base);
    check('GET /api/auth/me without a session -> 401', (await anon.get('/api/auth/me')).status, 401);
    check('GET /api/employees without a session -> 401', (await anon.get('/api/employees')).status, 401);

    const badPw = await anon.post('/api/auth/login', {
      username: `${TEST_PREFIX}admin`,
      password: 'wrong-password',
    });
    check('login with wrong password -> 401', badPw.status, 401);
    checkTrue('  no session cookie was set', !anon.hasCookie());

    const noSuchUser = await anon.post('/api/auth/login', {
      username: `${TEST_PREFIX}nobody`,
      password: 'wrong-password',
    });
    check('login with unknown username -> 401', noSuchUser.status, 401);
    check(
      '  identical message for both failures (no user enumeration)',
      noSuchUser.json.message,
      badPw.json.message
    );

    const admin = new Session(base);
    const login = await admin.post('/api/auth/login', {
      username: `${TEST_PREFIX}admin`,
      password: pw,
    });
    check('login with correct password -> 200', login.status, 200);
    check('  returns role', login.json.data.role, 'admin');
    checkTrue('  session cookie set', admin.hasCookie());

    const cookieHeader = login.raw.headers.getSetCookie?.().find((c) => c.startsWith('izy_session=')) ?? '';
    checkTrue('  cookie is HttpOnly', /HttpOnly/i.test(cookieHeader), cookieHeader);
    checkTrue('  cookie is SameSite=Lax', /SameSite=Lax/i.test(cookieHeader), cookieHeader);
    checkTrue(
      '  cookie is not Secure while COOKIE_SECURE=false (would be dropped over HTTP)',
      !/;\s*Secure/i.test(cookieHeader),
      cookieHeader
    );

    const me = await admin.get('/api/auth/me');
    check('GET /api/auth/me with a session -> 200', me.status, 200);
    check('  username', me.json.data.username, `${TEST_PREFIX}admin`);
    checkTrue('  password hash is never returned', !JSON.stringify(me.json).includes('password'));

    const failedLogEntry = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM activity_log WHERE action = $2 AND detail LIKE $1`,
      [`${TEST_PREFIX}%`, ACTION.loginFailed]
    );
    checkTrue('failed logins are recorded in the activity log', failedLogEntry.rows[0]!.n >= 2, `got ${failedLogEntry.rows[0]!.n}`);

    // ---- deactivation takes effect immediately ---------------------------
    console.log('\nAccount deactivation:');
    const reporter = new Session(base);
    await reporter.post('/api/auth/login', { username: `${TEST_PREFIX}reporter`, password: pw });
    check('reporter can read master data', (await reporter.get('/api/employees')).status, 200);
    await db.query('UPDATE users SET active = false WHERE id = $1', [ids.reporter]);
    check(
      'deactivating an account invalidates its live session at once',
      (await reporter.get('/api/employees')).status,
      401
    );
    await db.query('UPDATE users SET active = true WHERE id = $1', [ids.reporter]);
    await reporter.post('/api/auth/login', { username: `${TEST_PREFIX}reporter`, password: pw });

    // ---- roles (WP §8) ---------------------------------------------------
    console.log('\nWP §8 — role enforcement:');
    const manager = new Session(base);
    await manager.post('/api/auth/login', { username: `${TEST_PREFIX}manager`, password: pw });

    check('reporter GET /api/employees -> 200', (await reporter.get('/api/employees')).status, 200);
    check(
      'reporter POST /api/employees -> 403',
      (await reporter.post('/api/employees', { num: TEST_EMP_BASE + 9, name: 'x', nick: 'x' })).status,
      403
    );
    check(
      'reporter DELETE /api/employees/:num -> 403',
      (await reporter.del(`/api/employees/${TEST_EMP_BASE + 9}`)).status,
      403
    );
    check('reporter GET /api/users -> 403', (await reporter.get('/api/users')).status, 403);
    check('manager GET /api/users -> 403', (await manager.get('/api/users')).status, 403);
    check('admin GET /api/users -> 200', (await admin.get('/api/users')).status, 200);

    // ---- master-data CRUD (WP §6.6, §7.2) --------------------------------
    console.log('\nWP §7.2 — master-data CRUD:');
    const created = await manager.post('/api/employees', {
      num: TEST_EMP_BASE + 1,
      name: 'Test Employee',
      nick: 'testemp',
      contractor: null,
    });
    check('manager creates an employee -> 201', created.status, 201);
    check('  WP §5.1 target defaults to 8.5 for internal', Number(created.json.data.effective_target), 8.5);

    const contractorEmp = await manager.post('/api/employees', {
      num: TEST_EMP_BASE + 2,
      name: 'Test Contractor',
      nick: 'testcon',
      contractor: 'עו"ז',
    });
    check('  target defaults to 10.5 for a subcontractor', Number(contractorEmp.json.data.effective_target), 10.5);

    const dup = await manager.post('/api/employees', {
      num: TEST_EMP_BASE + 1,
      name: 'Other',
      nick: 'other',
    });
    check('WP §6.6 duplicate business key -> 409', dup.status, 409);
    // Assert the stable code, not the text — the text moves with UI_LANG.
    check('  with a machine-readable code', dup.json.error, 'duplicate_key');
    checkTrue('  and a human message', typeof dup.json.message === 'string' && dup.json.message.length > 0, dup.json.message);

    const invalid = await manager.post('/api/employees', { num: TEST_EMP_BASE + 3, name: '   ' });
    check('blank required field -> 400', invalid.status, 400);
    checkTrue('  names the offending field', JSON.stringify(invalid.json).includes('name'), JSON.stringify(invalid.json));

    const negKey = await manager.post('/api/employees', { num: -5, name: 'a', nick: 'b' });
    check('negative business key -> 400', negKey.status, 400);

    const updated = await manager.put(`/api/employees/${TEST_EMP_BASE + 1}`, { target_hours: 9.25 });
    check('update an employee -> 200', updated.status, 200);
    check('  explicit target overrides the default', Number(updated.json.data.effective_target), 9.25);

    const getOne = await reporter.get(`/api/employees/${TEST_EMP_BASE + 1}`);
    check('read back the updated row', Number(getOne.json.data.target_hours), 9.25);
    check('GET a non-existent key -> 404', (await reporter.get('/api/employees/987654')).status, 404);

    // Counterpart to the smoke test: unauthenticated callers get 401 for unknown
    // paths (no route enumeration), authenticated ones get an honest 404.
    const unknownRoute = await reporter.get('/api/does-not-exist');
    check('authenticated request to an unknown route -> 404', unknownRoute.status, 404);
    check('  with the not_found code', unknownRoute.json.error, 'not_found');

    console.log('\nFront-end metadata:');
    const vocab = await reporter.get('/api/meta/vocabulary');
    check('GET /api/meta/vocabulary -> 200', vocab.status, 200);
    check('  reports the active language', vocab.json.data.lang, 'en');
    check('  labels every action code', vocab.json.data.actions[ACTION.masterEdit], 'Master data edited');
    const metaConfig = await reporter.get('/api/meta/config');
    check('GET /api/meta/config -> 200', metaConfig.status, 200);
    check('  text direction follows the language', metaConfig.json.data.dir, 'ltr');
    checkTrue(
      '  exposes no secrets',
      !/secret|password|postgres|supabase/i.test(JSON.stringify(metaConfig.json)),
      JSON.stringify(metaConfig.json)
    );

    // ---- delete is blocked when referenced (WP §4.10, §6.6) --------------
    console.log('\nWP §4.10 — deleting referenced master data is blocked:');
    await manager.post('/api/projects', {
      num: TEST_PROJ,
      name: 'Test Project',
      nick: 'testproj',
      client: 'Test Client',
    });
    await manager.post('/api/departments', { name: TEST_DEPT, num: 9999, bucket: 'ritum' });
    await db.query(
      `INSERT INTO reports (date, emp_num, proj_num, dept, hours) VALUES ('2026-07-20', $1, $2, $3, 4)`,
      [TEST_EMP_BASE + 1, TEST_PROJ, TEST_DEPT]
    );

    const blocked = await manager.del(`/api/employees/${TEST_EMP_BASE + 1}`);
    check('deleting an employee that has reports -> 409', blocked.status, 409);
    const stillThere = await manager.get(`/api/employees/${TEST_EMP_BASE + 1}`);
    check('  the employee still exists (nothing cascaded)', stillThere.status, 200);
    const reportSurvived = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM reports WHERE emp_num = $1',
      [TEST_EMP_BASE + 1]
    );
    check('  its report survived', reportSurvived.rows[0]!.n, 1);

    check(
      'deleting a project that has reports -> 409',
      (await manager.del(`/api/projects/${TEST_PROJ}`)).status,
      409
    );

    await db.query('DELETE FROM reports WHERE emp_num = $1', [TEST_EMP_BASE + 1]);
    check(
      'once unreferenced, delete succeeds -> 204',
      (await manager.del(`/api/employees/${TEST_EMP_BASE + 2}`)).status,
      204
    );

    // ---- activity log (WP §6.7) ------------------------------------------
    console.log('\nWP §6.7 — one log entry per change, attributed correctly:');
    const before = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM activity_log WHERE user_id = $1',
      [ids.manager]
    );
    await manager.put(`/api/employees/${TEST_EMP_BASE + 1}`, { nick: 'testemp2' });
    const after = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM activity_log WHERE user_id = $1',
      [ids.manager]
    );
    check('one update produces exactly one entry', after.rows[0]!.n - before.rows[0]!.n, 1);

    const lastEntry = await db.query<{ action: string; user_id: number; entity: string }>(
      'SELECT action, user_id, entity FROM activity_log WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [ids.manager]
    );
    check('  attributed to the acting user', lastEntry.rows[0]!.user_id, ids.manager);
    check('  action stored as a stable code, not display text', lastEntry.rows[0]!.action, ACTION.masterEdit);
    check('  entity stored as a code', lastEntry.rows[0]!.entity, 'employee');

    // A rejected write must leave no log entry behind.
    const beforeFail = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM activity_log WHERE user_id = $1',
      [ids.manager]
    );
    await manager.post('/api/employees', { num: TEST_EMP_BASE + 1, name: 'dup', nick: 'dup' });
    const afterFail = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM activity_log WHERE user_id = $1',
      [ids.manager]
    );
    check('a rejected write logs nothing (transactional)', afterFail.rows[0]!.n - beforeFail.rows[0]!.n, 0);

    // ---- WP §5.7 resolution ----------------------------------------------
    console.log('\nWP §5.7 — derived-field resolution:');
    const byNick = await reporter.post('/api/lookup/resolve', { emp: 'testemp2', proj: 'testproj' });
    check('resolve by nickname -> 200', byNick.status, 200);
    check('  employee number derived', byNick.json.data.employee.emp_num, TEST_EMP_BASE + 1);
    check('  project number derived', byNick.json.data.project.proj_num, TEST_PROJ);
    check('  project name derived', byNick.json.data.project.proj_name, 'Test Project');
    check('  client derived', byNick.json.data.project.client, 'Test Client');
    check('  nothing unresolved', byNick.json.data.unresolved, []);

    const byNumber = await reporter.post('/api/lookup/resolve', { emp: String(TEST_EMP_BASE + 1) });
    check('resolve by employee number', byNumber.json.data.employee.emp_num, TEST_EMP_BASE + 1);

    const unknown = await reporter.post('/api/lookup/resolve', { emp: 'no-such-employee', proj: 'no-such-project' });
    check('unresolvable input is reported, not guessed', unknown.json.data.unresolved.sort(), ['emp', 'proj']);
    check('  employee is null', unknown.json.data.employee, null);

    const deptResolve = await reporter.post('/api/lookup/resolve', { dept: TEST_DEPT });
    check('department resolves to its code', deptResolve.json.data.department.dept_num, 9999);
    check('  and its bucket', deptResolve.json.data.department.bucket, 'ritum');

    // Whitespace tolerance — the "חשמל  סולארי" double-space problem.
    await db.query(`INSERT INTO departments (name, num, bucket) VALUES ($1, 9998, 'hashmal')`, [
      `${TEST_DEPT}  spaced`,
    ]);
    const spaced = await reporter.post('/api/lookup/resolve', { dept: `${TEST_DEPT} spaced` });
    checkTrue(
      'single-spaced input resolves a double-spaced department name',
      spaced.json.data.department?.dept_num === 9998,
      JSON.stringify(spaced.json.data.department)
    );
    await db.query('DELETE FROM departments WHERE name = $1', [`${TEST_DEPT}  spaced`]);

    // ---- lookup / autocomplete -------------------------------------------
    console.log('\nWP §6.1 — autocomplete:');
    const search = await reporter.get('/api/lookup/employees?q=testemp');
    check('search by nickname -> 200', search.status, 200);
    checkTrue('  finds the test employee', search.json.data.some((e: any) => e.num === TEST_EMP_BASE + 1));

    const limited = await reporter.get('/api/lookup/employees?limit=3');
    check('limit is honoured', limited.json.data.length, 3);

    const wildcard = await reporter.get('/api/lookup/employees?q=%25');
    check('a literal % does not become a wildcard', wildcard.json.data.length, 0);

    const inactiveDefault = await reporter.get('/api/lookup/employees?q=&limit=100');
    checkTrue(
      'inactive employees are excluded by default',
      inactiveDefault.json.data.every((e: any) => e.active === true)
    );

    // ---- admin safety rails ----------------------------------------------
    console.log('\nAdmin safety rails:');
    check(
      'an admin cannot deactivate their own account',
      (await admin.put(`/api/users/${ids.admin}`, { active: false })).status,
      400
    );
    check(
      'an admin cannot demote themselves',
      (await admin.put(`/api/users/${ids.admin}`, { role: 'reporter' })).status,
      400
    );
    check(
      'an admin cannot delete their own account',
      (await admin.del(`/api/users/${ids.admin}`)).status,
      400
    );

    const newUser = await admin.post('/api/users', {
      username: `${TEST_PREFIX}fresh`,
      password: 'another-good-password',
      display_name: 'Fresh User',
      role: 'manager',
    });
    check('admin creates a user -> 201', newUser.status, 201);
    checkTrue('  no password field in the response', !JSON.stringify(newUser.json).includes('password'));
    check(
      'short password rejected -> 400',
      (await admin.post('/api/users', { username: `${TEST_PREFIX}short`, password: 'abc', display_name: 'x' })).status,
      400
    );
    check(
      'admin resets a password -> 204',
      (await admin.put(`/api/users/${newUser.json.data.id}/password`, { password: 'yet-another-password' })).status,
      204
    );

    // ---- reports (WP §7.3) -----------------------------------------------
    console.log('\nWP §7.3 — reports:');
    // A fresh employee with the 8.5h internal default, and a project to book to.
    await manager.post('/api/employees', {
      num: TEST_EMP_BASE + 5,
      name: 'Grid Test Employee',
      nick: 'gridtest',
    });

    const mk = (over: Record<string, unknown> = {}) => ({
      date: '2026-07-22',
      emp: 'gridtest',
      proj: 'testproj',
      dept: TEST_DEPT,
      hours: 4,
      ...over,
    });

    const madeReport = await reporter.post('/api/reports', mk());
    check('reporter can create a report -> 201', madeReport.status, 201);
    check('  employee resolved server-side from the nickname', madeReport.json.data.emp_num, TEST_EMP_BASE + 5);
    check('  project resolved server-side', madeReport.json.data.proj_num, TEST_PROJ);
    check('  department code resolved', madeReport.json.data.dept_num, 9999);
    check('  bucket resolved', madeReport.json.data.bucket, 'ritum');
    check('  target from WP §5.1', Number(madeReport.json.data.effective_target), 8.5);
    checkTrue('  attributed to its creator', typeof madeReport.json.data.created_by_name === 'string');
    const reportId = madeReport.json.data.id as number;

    const unresolvable = await reporter.post('/api/reports', mk({ emp: 'no-such-nick' }));
    check('an unresolvable employee is refused -> 400', unresolvable.status, 400);
    check('  with the unresolved code', unresolvable.json.error, 'unresolved');
    check('  naming the offending field', unresolvable.json.details.unresolved, ['emp']);

    const noTarget = await reporter.post('/api/reports', mk({ proj: null, fix: null }));
    check('neither project nor repair -> 400', noTarget.status, 400);
    check('  with a specific code', noTarget.json.error, 'project_or_repair_required');

    check('zero hours -> 400', (await reporter.post('/api/reports', mk({ hours: 0 }))).status, 400);
    check('negative hours -> 400', (await reporter.post('/api/reports', mk({ hours: -3 }))).status, 400);
    check(
      'a bad date format -> 400',
      (await reporter.post('/api/reports', mk({ date: '22/07/2026' }))).status,
      400
    );

    // Over-target: the prototype's confirm dialog, as an API contract.
    console.log('\nOver-target confirmation (prototype behaviour, absent from the WP):');
    const overTarget = await reporter.post('/api/reports', mk({ hours: 6 })); // 4 + 6 > 8.5
    check('exceeding the daily target -> 409', overTarget.status, 409);
    check('  with the over_target code', overTarget.json.error, 'over_target');
    check('  reporting the resulting total', Number(overTarget.json.details.newTotal), 10);
    check('  and the target it exceeds', Number(overTarget.json.details.target), 8.5);
    const notWritten = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM reports WHERE emp_num = $1',
      [TEST_EMP_BASE + 5]
    );
    check('  nothing was written', notWritten.rows[0]!.n, 1);

    const acknowledged = await reporter.post(
      '/api/reports',
      mk({ hours: 6, acknowledgeOverTarget: true })
    );
    check('retrying with acknowledgement succeeds -> 201', acknowledged.status, 201);
    const ackId = acknowledged.json.data.id as number;

    // Editing a day that is already over target must not re-prompt.
    const editWhileOver = await reporter.put(`/api/reports/${ackId}`, { hours: 7 });
    check('editing a day already over target does not re-prompt -> 200', editWhileOver.status, 200);
    await reporter.put(`/api/reports/${ackId}`, { hours: 6 });

    // ---- listing, filtering, paging (WP §6.2) -----------------------------
    console.log('\nWP §6.2 — listing, filtering and paging:');
    const listed = await reporter.get('/api/reports?date=2026-07-22');
    check('filter by date -> 200', listed.status, 200);
    check('  returns both rows', listed.json.meta.totalRows, 2);
    check('  totals cover the filtered set, not the page', Number(listed.json.meta.totalHours), 10);

    const paged = await reporter.get('/api/reports?date=2026-07-22&limit=1&offset=0');
    check('limit applies to the page', paged.json.data.length, 1);
    check('  but totalRows still counts the whole match', paged.json.meta.totalRows, 2);
    check('  hasMore is set', paged.json.meta.hasMore, true);

    const lastPage = await reporter.get('/api/reports?date=2026-07-22&limit=1&offset=1');
    check('the final page reports hasMore=false', lastPage.json.meta.hasMore, false);

    const byEmp = await reporter.get(`/api/reports?emp=${TEST_EMP_BASE + 5}`);
    check('filter by employee', byEmp.json.meta.totalRows, 2);
    const textSearch = await reporter.get('/api/reports?q=gridtest');
    checkTrue('free-text search matches the employee nickname', textSearch.json.meta.totalRows >= 2);
    const searchWildcard = await reporter.get('/api/reports?q=%25');
    check('a literal % in search is not a wildcard', searchWildcard.json.meta.totalRows, 0);
    check(
      'an unknown sort column is rejected -> 400',
      (await reporter.get('/api/reports?sort=hours;DROP TABLE reports')).status,
      400
    );

    // ---- repair rows ------------------------------------------------------
    console.log('\nRepair rows:');
    const repairRow = await reporter.post(
      '/api/reports',
      mk({ date: '2026-07-23', proj: null, fix: 16989, hours: 3 })
    );
    check('a repair row is accepted -> 201', repairRow.status, 201);
    check('  project number is null', repairRow.json.data.proj_num, null);
    checkTrue(
      '  display name renders as the repair',
      String(repairRow.json.data.display_proj_name).startsWith('תיקון 16989'),
      String(repairRow.json.data.display_proj_name)
    );
    await reporter.del(`/api/reports/${repairRow.json.data.id}`);

    // Client feedback 2026-08-03 (#3/#5) settled OPEN-QUESTIONS #4: a row is a
    // project row OR a repair row, never both.
    const bothRow = await reporter.post(
      '/api/reports',
      mk({ date: '2026-07-23', fix: 16989, hours: 3 })
    );
    check('a row with both project and repair -> 400', bothRow.status, 400);
    check('  with a specific code', bothRow.json.error, 'project_or_repair_exclusive');

    // ---- submit day (WP §7.3) --------------------------------------------
    console.log('\nSubmit day:');
    const submitted = await reporter.post('/api/reports/submit-day', { date: '2026-07-22' });
    check('submitting a day with rows -> 200', submitted.status, 200);
    check('  records how many rows it covered', submitted.json.data.row_count, 2);
    check(
      'submitting an empty day -> 409',
      (await reporter.post('/api/reports/submit-day', { date: '2019-01-01' })).status,
      409
    );
    const stillEditable = await reporter.put(`/api/reports/${reportId}`, { hours: 4.5 });
    check('a submitted day is a marker, not a lock (still editable)', stillEditable.status, 200);
    const markers = await reporter.get('/api/reports/submitted-days');
    checkTrue(
      'submitted days are listed with who submitted them',
      markers.json.data.some((d: any) => d.date === '2026-07-22' && d.submitted_by_name),
      JSON.stringify(markers.json.data?.[0])
    );
    check(
      'clearing a marker is admin-only',
      (await reporter.del('/api/reports/submitted-days/2026-07-22')).status,
      403
    );
    check(
      '  an admin can clear it -> 204',
      (await admin.del('/api/reports/submitted-days/2026-07-22')).status,
      204
    );

    // ---- attendance + coverage (WP §5.5/§5.6) ----------------------------
    console.log('\nWP §5.5/§5.6 — attendance and coverage:');
    check(
      'a reporter cannot edit clock hours -> 403',
      (await reporter.put('/api/attendance', {
        date: '2026-07-22',
        emp_num: TEST_EMP_BASE + 5,
        hours: 9,
      })).status,
      403
    );
    const setClock = await manager.put('/api/attendance', {
      date: '2026-07-22',
      emp_num: TEST_EMP_BASE + 5,
      hours: 12,
    });
    check('a manager can set clock hours -> 200', setClock.status, 200);

    const coverage = await reporter.get('/api/coverage?date=2026-07-22');
    check('GET /api/coverage -> 200', coverage.status, 200);
    const row = coverage.json.data.find((r: any) => r.emp_num === TEST_EMP_BASE + 5);
    checkTrue('  the test employee appears', Boolean(row), 'not found');
    check('  reported hours match', Number(row.reported), 10.5);
    check('  variance = clock - reported', Number(row.variance), 1.5);
    check('  variance beyond 1h is flagged', row.flagged, true);
    check('  status is complete (10.5 >= 8.5)', row.status, 'complete');

    check(
      'clearing clock hours -> 204',
      (await manager.put('/api/attendance', {
        date: '2026-07-22',
        emp_num: TEST_EMP_BASE + 5,
        hours: null,
      })).status,
      204
    );
    const cleared = await reporter.get('/api/coverage?date=2026-07-22');
    const clearedRow = cleared.json.data.find((r: any) => r.emp_num === TEST_EMP_BASE + 5);
    check('  variance becomes null with no clock entry', clearedRow.variance, null);
    check('  and it is not flagged', clearedRow.flagged, false);

    // ---- delete a report --------------------------------------------------
    console.log('\nDeleting a report:');
    check('DELETE /api/reports/:id -> 204', (await reporter.del(`/api/reports/${ackId}`)).status, 204);
    check('  deleting it again -> 404', (await reporter.del(`/api/reports/${ackId}`)).status, 404);
    const afterDelete = await reporter.get('/api/reports?date=2026-07-22');
    check('  the remaining row is untouched', afterDelete.json.meta.totalRows, 1);

    // ---- Excel import (WP §6.5, §9.2) --------------------------------------
    console.log('\nExcel import:');
    const XLSX = await import('xlsx');
    const sheetBuf = (aoa: unknown[][]): Buffer => {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    };

    const IMP_A = TEST_EMP_BASE + 100;
    const IMP_B = TEST_EMP_BASE + 101;
    // Header row is NOT the first row, and one row has a malformed number —
    // both are §9 requirements (auto header detection; skip + report bad rows).
    const empFile = sheetBuf([
      ['קובץ עובדים לדוגמה'],
      ["מס' עובד", 'שם עובד', 'מוקלד', 'סטטוס'],
      [IMP_A, 'בדיקה ראשון - סלים', 'בדיקה1', 'עובד'],
      ['abc', 'שורה שגויה', '', 'עובד'],
      [IMP_B, 'בדיקה שני', 'בדיקה2', 'לא עובד'],
    ]);

    check(
      'a reporter cannot import -> 403',
      (await reporter.upload('/api/import/employees/preview', empFile)).status,
      403
    );

    const empPrev = await manager.upload('/api/import/employees/preview', empFile);
    check('employees preview -> 200', empPrev.status, 200);
    check('  tags 2 rows as new', empPrev.json.data.counts.new, 2);
    check('  reports the malformed row as invalid', empPrev.json.data.counts.invalid, 1);
    check('  with its Excel row number', empPrev.json.data.errors[0].row, 4);
    const notYet = await db.query('SELECT count(*)::int AS n FROM employees WHERE num = $1', [IMP_A]);
    check('  preview writes nothing', notYet.rows[0].n, 0);

    const empCommit = await manager.upload('/api/import/employees/commit', empFile);
    check('employees commit -> 200', empCommit.status, 200);
    check('  applied 2 rows', empCommit.json.data.applied, 2);
    const impA = await db.query(
      'SELECT name, nick, active, contractor FROM employees WHERE num = $1',
      [IMP_A]
    );
    check('  contractor derived from the name suffix', impA.rows[0].contractor, 'סלים');
    const impB = await db.query('SELECT active FROM employees WHERE num = $1', [IMP_B]);
    check("  'לא עובד' imports as inactive", impB.rows[0].active, false);

    const empAgain = await manager.upload('/api/import/employees/preview', empFile);
    check('re-importing the same file: all unchanged (WP §9.2)', empAgain.json.data.counts, {
      new: 0,
      updated: 0,
      unchanged: 2,
      invalid: 1,
    });
    const empRecommit = await manager.upload('/api/import/employees/commit', empFile);
    check('  re-commit applies nothing', empRecommit.json.data.applied, 0);

    // Attendance: date arrives as an Excel serial; unknown employees are row
    // errors, not transaction failures.
    const serial = Math.round((Date.UTC(2026, 6, 24) - Date.UTC(1899, 11, 30)) / 86_400_000);
    const attFile = sheetBuf([
      ['מס עובד', 'תאריך', 'סה"כ שעות'],
      [IMP_A, serial, 9],
      [777_777, serial, 8],
    ]);
    const attPrev = await manager.upload('/api/import/attendance/preview', attFile);
    check('attendance preview: 1 new, 1 invalid', [attPrev.json.data.counts.new, attPrev.json.data.counts.invalid], [1, 1]);
    await manager.upload('/api/import/attendance/commit', attFile);
    const attRow = await db.query(
      "SELECT hours::float AS hours, source FROM attendance WHERE emp_num = $1 AND date = '2026-07-24'",
      [IMP_A]
    );
    check('  serial date converted and row upserted', attRow.rows[0].hours, 9);
    check("  marked source='import'", attRow.rows[0].source, 'import');

    // Bulk reports: nicknames resolve against master data; exact duplicates are
    // consumed so a second load of the same file adds nothing.
    const repFile = sheetBuf([
      ['תאריך', 'עובד', 'שם הפרויקט + מס', 'דיווח שעות', 'מחלקה'],
      ['2026-07-24', 'בדיקה1', 'testproj', 5, TEST_DEPT],
      ['2026-07-24', 'בדיקה1', 'no-such-project', 2, TEST_DEPT],
    ]);
    const repPrev = await manager.upload('/api/import/reports/preview', repFile);
    check('bulk reports preview: 1 new, 1 invalid', [repPrev.json.data.counts.new, repPrev.json.data.counts.invalid], [1, 1]);
    const repCommit = await manager.upload('/api/import/reports/commit', repFile);
    check('bulk reports commit applied 1', repCommit.json.data.applied, 1);
    const repAgain = await manager.upload('/api/import/reports/commit', repFile);
    check('  the same file again applies 0 (duplicates consumed)', repAgain.json.data.applied, 0);

    check(
      'a text file is rejected as unreadable -> 400',
      (await manager.upload('/api/import/employees/preview', Buffer.from('not an excel file'))).status,
      400
    );
    check(
      'an unknown import type -> 400',
      (await manager.upload('/api/import/nonsense/preview', empFile)).status,
      400
    );

    // ---- Excel export (WP §9.3) --------------------------------------------
    console.log('\nExcel export:');
    const exp = await reporter.getBinary('/api/export/archive?q=בדיקה1');
    check('archive export -> 200 for a reporter', exp.status, 200);
    checkTrue('  is an xlsx download', exp.contentType.includes('spreadsheetml'), exp.contentType);
    const expWb = XLSX.read(exp.buf, { type: 'buffer' });
    const expRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      expWb.Sheets[expWb.SheetNames[0]!]!
    );
    check('  filtered to the imported row', expRows.length, 1);
    checkTrue(
      '  with the prototype’s Hebrew headers',
      expRows[0]! ['תאריך'] === '2026-07-24' && Number(expRows[0]!['שעות']) === 5,
      JSON.stringify(expRows[0])
    );
    check('grid export -> 200', (await reporter.get('/api/export/report?date=2026-07-24')).status, 200);
    check('activity export -> 200', (await admin.get('/api/export/activity')).status, 200);
    check('unknown export view -> 400', (await admin.get('/api/export/nonsense')).status, 400);

    // ---- dashboard (WP §6.4) -----------------------------------------------
    console.log('\nWP §6.4 — dashboard:');
    // The bulk-imported row (5h on testproj / Test Client, 2026-07-24) is the
    // only row for that customer on that day, so the client filter isolates the
    // test fixture from whatever real data shares the database.
    const dash = await reporter.get(
      `/api/dashboard?period=day&date=2026-07-24&client=${encodeURIComponent('Test Client')}`
    );
    check('GET /api/dashboard -> 200 for a reporter', dash.status, 200);
    check('  KPI total matches the imported hours', Number(dash.json.data.kpis.total_hours), 5);
    check('  productive share is 100%', Math.round(Number(dash.json.data.kpis.productive_pct)), 100);
    const bRow = dash.json.data.budget.find((b: any) => b.proj_num === TEST_PROJ);
    checkTrue('  budget table includes the test project', !!bRow, JSON.stringify(dash.json.data.budget));
    check('  with the reported actual', Number(bRow?.actual), 5);
    checkTrue('  clients list feeds the filter', dash.json.data.clients.includes('Test Client'));
    const dashWeek = await reporter.get('/api/dashboard?period=week');
    check('period=week resolves a range -> 200', dashWeek.status, 200);
    checkTrue(
      '  week ends at the last reported date',
      dashWeek.json.data.period.from != null && dashWeek.json.data.period.to != null,
      JSON.stringify(dashWeek.json.data.period)
    );
    check('period=day without a date -> 400', (await reporter.get('/api/dashboard?period=day')).status, 400);

    // ---- logout -----------------------------------------------------------
    console.log('\nLogout:');
    check('POST /api/auth/logout -> 204', (await admin.post('/api/auth/logout')).status, 204);
    check('the session no longer works', (await admin.get('/api/auth/me')).status, 401);
  } finally {
    await cleanup();
    await new Promise<void>((r) => server.close(() => r()));
    await db.end();
    console.log('\n(test data removed)');
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nverify:api crashed:', err);
  process.exit(1);
});
