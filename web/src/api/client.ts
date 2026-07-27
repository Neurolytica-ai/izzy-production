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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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

  return (parsed as Envelope<T>).data;
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
