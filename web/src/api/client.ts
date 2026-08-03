/**
 * The only place in the front end that talks to the server.
 *
 * Two things it deliberately owns:
 *
 *   - Error shape. The API always returns a stable machine-readable `error` code
 *     alongside a translated `message`. Callers branch on `code`; only the
 *     message is ever shown to a user. Nothing in the UI should compare message
 *     text, because that text moves with UI_LANG.
 *   - Session expiry. A 401 anywhere means the cookie is gone or stale, so it is
 *     surfaced as one recognisable error type that the app shell turns into a
 *     return to the login screen. Handling that per-screen would guarantee some
 *     screen forgets.
 */

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: FieldIssue[]
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the session is missing or expired. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  /** Field-level validation problems, if the server reported any. */
  fieldMessage(field: string): string | undefined {
    return this.details?.find((d) => d.field === field)?.message;
  }
}

interface Envelope<T> {
  data: T;
  count?: number;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, 'bad_response', 'The server returned an unreadable response.');
    }
  }

  if (!res.ok) {
    const err = (parsed ?? {}) as { error?: string; message?: string; details?: FieldIssue[] };
    throw new ApiError(
      res.status,
      err.error ?? 'error',
      err.message ?? `Request failed (${res.status})`,
      err.details
    );
  }

  return parsed as T;
}

async function requestRaw<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      // Same-origin in both dev (Vite proxy) and production (Nginx), so the
      // session cookie is first-party and needs no CORS handling.
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // fetch only rejects on a transport failure, never on a 4xx/5xx.
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection.');
  }
  return parseResponse<T>(res);
}

/** Multipart upload — the browser sets the content-type (with its boundary) itself. */
async function requestUpload<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', credentials: 'same-origin', body: fd });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection.');
  }
  return parseResponse<T>(res);
}

/** Unwraps the standard `{ data }` envelope — the shape almost every endpoint returns. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const raw = await requestRaw<Envelope<T>>(method, path, body);
  return raw.data;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

/* -------------------------------------------------------------------------- */
/* Types mirroring the server's read models                                   */
/* -------------------------------------------------------------------------- */

export type Role = 'reporter' | 'manager' | 'admin';

export interface CurrentUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  emp_num: number | null;
}

export interface Employee {
  num: number;
  name: string;
  nick: string;
  active: boolean;
  contractor: string | null;
  target_hours: number | null;
  /** WP §5.1, computed by the database. Read-only here. */
  effective_target: number;
}

export interface Project {
  num: number;
  name: string;
  nick: string;
  client: string;
  overhead: boolean;
}

export interface Department {
  name: string;
  num: number | null;
  bucket: string | null;
}

export interface Bucket {
  key: string;
  label_he: string;
  sort_order: number;
}

export interface StandardBox {
  box: number;
  name: string;
  parent: number | null;
  total: number;
  pah: number;
  misgarot: number;
  hazraka: number;
  panelim: number;
  hadbaka: number;
  ritum: number;
  dlatot: number;
  hashmal: number;
  psei: number;
  hashlamot: number;
}

export interface Repair {
  fix: number;
  client: string;
  date: string | null;
  model: string | null;
}

export interface UserAccount {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  emp_num: number | null;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface ResolvedRow {
  employee: {
    emp_num: number;
    emp_nick: string;
    emp_name: string;
    contractor: string | null;
    effective_target: number;
  } | null;
  project: {
    proj_num: number;
    proj_nick: string;
    proj_name: string;
    client: string;
    overhead: boolean;
  } | null;
  department: { dept: string; dept_num: number | null; bucket: string | null } | null;
  repair: { fix: number; client: string; date: string | null } | null;
  /** Which supplied fields could not be matched — the grid's "not identified". */
  unresolved: string[];
}

/**
 * A row of `v_reports_full` — every derived field resolved by the server, so the
 * grid and the archive render the same shape and neither has to resolve anything
 * itself. Hours come back as a string because the column is `numeric`; render and
 * arithmetic go through Number().
 */
export interface ReportRow {
  id: number;
  date: string;
  emp_num: number;
  emp_nick: string;
  emp_name: string;
  contractor: string | null;
  effective_target: number;
  proj_num: number | null;
  proj_nick: string | null;
  proj_name: string | null;
  client: string | null;
  overhead: boolean | null;
  fix: number | null;
  display_proj_name: string | null;
  repair_client: string | null;
  dept: string;
  dept_num: number | null;
  bucket: string | null;
  hours: number | string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** What the grid sends for a create/update — typed values, resolved server-side. */
export interface ReportInput {
  date?: string;
  emp?: string | number | null;
  proj?: string | number | null;
  fix?: string | number | null;
  dept?: string;
  hours?: number;
  acknowledgeOverTarget?: boolean;
}

export interface ReportListParams {
  date?: string;
  from?: string;
  to?: string;
  emp?: number;
  proj?: number;
  client?: string;
  dept?: string;
  q?: string;
  limit?: number;
  offset?: number;
  sort?: 'date' | 'emp_nick' | 'emp_name' | 'proj_nick' | 'proj_name' | 'client' | 'dept' | 'hours' | 'fix';
  dir?: 'asc' | 'desc';
}

export interface ReportListMeta {
  totalRows: number;
  totalHours: number;
  days: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ReportPage {
  data: ReportRow[];
  count: number;
  meta: ReportListMeta;
}

export interface SubmittedDay {
  date: string;
  submitted_at: string;
  row_count: number;
  submitted_by_name: string | null;
}

export interface ActivityRow {
  id: number;
  ts: string;
  user_id: number | null;
  user_name: string | null;
  /** Stable code — display label comes from /api/meta/vocabulary. */
  action: string;
  detail: string;
  entity: string | null;
  entity_key: string | null;
}

export interface ActivityListParams {
  from?: string;
  to?: string;
  action?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityPage {
  data: ActivityRow[];
  count: number;
  meta: { totalRows: number; limit: number; offset: number; hasMore: boolean };
}

/** One row of fn_coverage — WP §5.5/§5.6. Numerics arrive as strings (pg numeric). */
export interface CoverageRow {
  emp_num: number;
  nick: string;
  name: string;
  contractor: string | null;
  is_contractor: boolean;
  reported: number | string;
  target: number | string;
  status: 'complete' | 'partial' | 'not_reported';
  clock: number | string | null;
  variance: number | string | null;
  flagged: boolean;
}

export interface DashboardKpis {
  total_hours: number | string;
  productive_hours: number | string;
  overhead_hours: number | string;
  productive_pct: number | string | null;
  overhead_pct: number | string | null;
  overruns: number;
  savings: number;
  no_standard: number;
}

export interface BudgetRow {
  proj_num: number;
  proj_nick: string;
  proj_name: string;
  client: string;
  boxes: number;
  std_total: number;
  actual: number | string;
  variance: number | string;
  utilization: number | string | null;
  state: 'overrun' | 'saving' | 'on_target' | 'no_standard';
}

export interface BucketRow {
  bucket: string;
  label_he: string;
  hours: number | string;
  sort_order: number;
}

export type DashPeriod = 'day' | 'week' | 'month' | 'all';

export interface DashboardData {
  period: { kind: DashPeriod; from: string | null; to: string | null };
  kpis: DashboardKpis;
  budget: BudgetRow[];
  buckets: BucketRow[];
  clients: string[];
}

export interface DashboardParams {
  period: DashPeriod;
  date?: string;
  month?: string;
  client?: string;
}

export type ImportType =
  | 'employees'
  | 'projects'
  | 'departments'
  | 'standard'
  | 'repairs'
  | 'attendance'
  | 'reports';

export interface ImportCounts {
  new: number;
  updated: number;
  unchanged: number;
  invalid: number;
}

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportPreview {
  type: ImportType;
  counts: ImportCounts;
  rows: { status: 'new' | 'update' | 'unchanged'; label: string }[];
  rowsTruncated: number;
  errors: ImportRowError[];
  errorsTruncated: number;
}

export interface ImportCommitResult {
  type: ImportType;
  applied: number;
  counts: ImportCounts;
  errors: ImportRowError[];
  errorsTruncated: number;
}

export type ExportView = 'report' | 'archive' | 'activity';

/** URL for a same-origin .xlsx download; the session cookie rides along. */
export function exportUrl(view: ExportView, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, v);
  }
  const suffix = qs.toString();
  return `/api/export/${view}${suffix ? `?${suffix}` : ''}`;
}

export interface AppConfig {
  lang: 'en' | 'he';
  dir: 'ltr' | 'rtl';
  sessionTtlHours: number;
}

export interface Vocabulary {
  lang: 'en' | 'he';
  actions: Record<string, string>;
  entities: Record<string, string>;
}

/* -------------------------------------------------------------------------- */

/** Department keys are Hebrew names, so they must be encoded in the path. */
const deptPath = (name: string) => `/api/departments/${encodeURIComponent(name)}`;

export const api = {
  auth: {
    login: (username: string, password: string) =>
      post<CurrentUser>('/api/auth/login', { username, password }),
    logout: () => post<void>('/api/auth/logout'),
    me: () => get<CurrentUser>('/api/auth/me'),
  },

  meta: {
    config: () => get<AppConfig>('/api/meta/config'),
    vocabulary: () => get<Vocabulary>('/api/meta/vocabulary'),
  },

  employees: {
    list: (opts: { active?: boolean } = {}) =>
      get<Employee[]>(
        `/api/employees${opts.active === undefined ? '' : `?active=${opts.active}`}`
      ),
    create: (body: Partial<Employee>) => post<Employee>('/api/employees', body),
    update: (num: number, body: Partial<Employee>) => put<Employee>(`/api/employees/${num}`, body),
    remove: (num: number) => del<void>(`/api/employees/${num}`),
  },

  projects: {
    list: (opts: { overhead?: boolean } = {}) =>
      get<Project[]>(
        `/api/projects${opts.overhead === undefined ? '' : `?overhead=${opts.overhead}`}`
      ),
    create: (body: Partial<Project>) => post<Project>('/api/projects', body),
    update: (num: number, body: Partial<Project>) => put<Project>(`/api/projects/${num}`, body),
    remove: (num: number) => del<void>(`/api/projects/${num}`),
  },

  departments: {
    list: () => get<Department[]>('/api/departments'),
    create: (body: Partial<Department>) => post<Department>('/api/departments', body),
    update: (name: string, body: Partial<Department>) => put<Department>(deptPath(name), body),
    remove: (name: string) => del<void>(deptPath(name)),
  },

  standard: {
    list: (opts: { parent?: number } = {}) =>
      get<StandardBox[]>(`/api/standard${opts.parent ? `?parent=${opts.parent}` : ''}`),
    create: (body: Partial<StandardBox>) => post<StandardBox>('/api/standard', body),
    update: (box: number, body: Partial<StandardBox>) =>
      put<StandardBox>(`/api/standard/${box}`, body),
    remove: (box: number) => del<void>(`/api/standard/${box}`),
  },

  repairs: {
    list: () => get<Repair[]>('/api/repairs'),
    create: (body: Partial<Repair>) => post<Repair>('/api/repairs', body),
    update: (fix: number, body: Partial<Repair>) => put<Repair>(`/api/repairs/${fix}`, body),
    remove: (fix: number) => del<void>(`/api/repairs/${fix}`),
  },

  buckets: {
    list: () => get<Bucket[]>('/api/buckets'),
  },

  users: {
    list: () => get<UserAccount[]>('/api/users'),
    create: (body: Record<string, unknown>) => post<UserAccount>('/api/users', body),
    update: (id: number, body: Record<string, unknown>) =>
      put<UserAccount>(`/api/users/${id}`, body),
    setPassword: (id: number, password: string) =>
      put<void>(`/api/users/${id}/password`, { password }),
    remove: (id: number) => del<void>(`/api/users/${id}`),
  },

  reports: {
    list: (params: ReportListParams = {}) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
      const suffix = qs.toString();
      return requestRaw<ReportPage>('GET', `/api/reports${suffix ? `?${suffix}` : ''}`);
    },
    create: (body: ReportInput) => post<ReportRow>('/api/reports', body),
    update: (id: number, body: ReportInput) => put<ReportRow>(`/api/reports/${id}`, body),
    remove: (id: number) => del<void>(`/api/reports/${id}`),
    submitDay: (date: string) =>
      post<{ date: string; submitted_at: string; row_count: number }>('/api/reports/submit-day', {
        date,
      }),
    submittedDays: (range: { from?: string; to?: string } = {}) => {
      const qs = new URLSearchParams();
      if (range.from) qs.set('from', range.from);
      if (range.to) qs.set('to', range.to);
      const suffix = qs.toString();
      return get<SubmittedDay[]>(`/api/reports/submitted-days${suffix ? `?${suffix}` : ''}`);
    },
  },

  coverage: {
    list: (date: string) => get<CoverageRow[]>(`/api/coverage?date=${date}`),
  },

  attendance: {
    /** hours: null clears the clock entry. Manager/admin only (server-enforced). */
    set: (date: string, emp_num: number, hours: number | null) =>
      requestRaw<unknown>('PUT', '/api/attendance', { date, emp_num, hours }),
  },

  dashboard: {
    get: (params: DashboardParams) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') qs.set(k, String(v));
      }
      return get<DashboardData>(`/api/dashboard?${qs.toString()}`);
    },
  },

  imports: {
    preview: (type: ImportType, file: File) =>
      requestUpload<{ data: ImportPreview }>(`/api/import/${type}/preview`, file).then((r) => r.data),
    commit: (type: ImportType, file: File) =>
      requestUpload<{ data: ImportCommitResult }>(`/api/import/${type}/commit`, file).then((r) => r.data),
  },

  activity: {
    list: (params: ActivityListParams = {}) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
      const suffix = qs.toString();
      return requestRaw<ActivityPage>('GET', `/api/activity-log${suffix ? `?${suffix}` : ''}`);
    },
    clear: () => del<void>('/api/activity-log'),
  },

  lookup: {
    employees: (q: string, limit = 50) =>
      get<Employee[]>(`/api/lookup/employees?q=${encodeURIComponent(q)}&limit=${limit}`),
    projects: (q: string, limit = 50) =>
      get<Project[]>(`/api/lookup/projects?q=${encodeURIComponent(q)}&limit=${limit}`),
    departments: (q: string, limit = 50) =>
      get<(Department & { bucket_label: string | null })[]>(
        `/api/lookup/departments?q=${encodeURIComponent(q)}&limit=${limit}`
      ),
    repairs: (q: string, limit = 50) =>
      get<Repair[]>(`/api/lookup/repairs?q=${encodeURIComponent(q)}&limit=${limit}`),
    /** WP §5.7 — resolve typed nicknames to numeric keys. */
    resolve: (input: { emp?: string | null; proj?: string | null; dept?: string | null; fix?: string | number | null }) =>
      post<ResolvedRow>('/api/lookup/resolve', input),
  },
};
