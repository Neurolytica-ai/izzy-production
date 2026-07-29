/**
 * React Query bindings.
 *
 * Query keys are centralised so a mutation can invalidate exactly what it
 * affected. That is what makes WP §6.1's concurrency requirement — "two users
 * entering rows for the same date do not overwrite each other's data" — cheap:
 * the server is authoritative, and after any write the affected queries refetch
 * rather than the client trusting its own copy.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import {
  api,
  type CurrentUser,
  type Department,
  type Employee,
  type Project,
  type Repair,
  type ReportInput,
  type ReportListParams,
  type StandardBox,
  type UserAccount,
} from './client.ts';

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  vocabulary: ['vocabulary'] as const,
  employees: (active?: boolean) => ['employees', active ?? 'all'] as const,
  projects: (overhead?: boolean) => ['projects', overhead ?? 'all'] as const,
  departments: ['departments'] as const,
  standard: (parent?: number) => ['standard', parent ?? 'all'] as const,
  repairs: ['repairs'] as const,
  buckets: ['buckets'] as const,
  users: ['users'] as const,
  reports: (params: ReportListParams) => ['reports', params] as const,
  submittedDays: (range: { from?: string; to?: string }) => ['submittedDays', range] as const,
};

/** Master data changes rarely; no need to refetch it on every mount. */
const MASTER_STALE_MS = 60_000;

export function useMe(options?: Partial<UseQueryOptions<CurrentUser>>) {
  return useQuery({
    queryKey: keys.me,
    queryFn: api.auth.me,
    // A 401 here is the normal "not signed in" answer, not a transient failure.
    retry: false,
    staleTime: MASTER_STALE_MS,
    ...options,
  });
}

export function useAppConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: api.meta.config,
    staleTime: Infinity,
  });
}

export function useEmployees(active?: boolean) {
  return useQuery({
    queryKey: keys.employees(active),
    queryFn: () => api.employees.list(active === undefined ? {} : { active }),
    staleTime: MASTER_STALE_MS,
  });
}

export function useProjects(overhead?: boolean) {
  return useQuery({
    queryKey: keys.projects(overhead),
    queryFn: () => api.projects.list(overhead === undefined ? {} : { overhead }),
    staleTime: MASTER_STALE_MS,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: keys.departments,
    queryFn: api.departments.list,
    staleTime: MASTER_STALE_MS,
  });
}

export function useStandard(parent?: number) {
  return useQuery({
    queryKey: keys.standard(parent),
    queryFn: () => api.standard.list(parent === undefined ? {} : { parent }),
    staleTime: MASTER_STALE_MS,
  });
}

export function useRepairs() {
  return useQuery({
    queryKey: keys.repairs,
    queryFn: api.repairs.list,
    staleTime: MASTER_STALE_MS,
  });
}

export function useBuckets() {
  return useQuery({
    queryKey: keys.buckets,
    queryFn: api.buckets.list,
    staleTime: Infinity, // reference data, fixed at deploy time
  });
}

export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: api.users.list });
}

/**
 * The reporting grid and the archive both read through this. Reports change far
 * more often than master data, so there is no long stale time — after any write
 * the mutations below invalidate every `['reports', …]` key and the visible query
 * refetches, which is what keeps two people entering the same day consistent
 * (WP §6.1) without the client trusting its own copy.
 */
export function useReports(params: ReportListParams) {
  return useQuery({
    queryKey: keys.reports(params),
    queryFn: () => api.reports.list(params),
    // Keep the previous page on screen while the next one loads, so paging and
    // sorting in the archive do not flash empty.
    placeholderData: (prev) => prev,
  });
}

export function useSubmittedDays(range: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: keys.submittedDays(range),
    queryFn: () => api.reports.submittedDays(range),
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Any master-data write can change what the reporting grid resolves, so the
 * whole master-data family is invalidated rather than one narrow key. WP §6.6
 * requires an edit to be "immediately reflected in autocomplete and derived
 * columns everywhere", and a partial invalidation is how that quietly stops
 * being true.
 */
function useMasterMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['employees', 'projects', 'departments', 'standard', 'repairs']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export const useCreateEmployee = () =>
  useMasterMutation((body: Partial<Employee>) => api.employees.create(body));
export const useUpdateEmployee = () =>
  useMasterMutation(({ num, ...body }: Partial<Employee> & { num: number }) =>
    api.employees.update(num, body)
  );
export const useDeleteEmployee = () => useMasterMutation((num: number) => api.employees.remove(num));

export const useCreateProject = () =>
  useMasterMutation((body: Partial<Project>) => api.projects.create(body));
export const useUpdateProject = () =>
  useMasterMutation(({ num, ...body }: Partial<Project> & { num: number }) =>
    api.projects.update(num, body)
  );
export const useDeleteProject = () => useMasterMutation((num: number) => api.projects.remove(num));

export const useCreateDepartment = () =>
  useMasterMutation((body: Partial<Department>) => api.departments.create(body));
export const useUpdateDepartment = () =>
  useMasterMutation(({ name, ...body }: Partial<Department> & { name: string }) =>
    api.departments.update(name, body)
  );
export const useDeleteDepartment = () =>
  useMasterMutation((name: string) => api.departments.remove(name));

export const useCreateStandard = () =>
  useMasterMutation((body: Partial<StandardBox>) => api.standard.create(body));
export const useUpdateStandard = () =>
  useMasterMutation(({ box, ...body }: Partial<StandardBox> & { box: number }) =>
    api.standard.update(box, body)
  );
export const useDeleteStandard = () => useMasterMutation((box: number) => api.standard.remove(box));

export const useCreateRepair = () =>
  useMasterMutation((body: Partial<Repair>) => api.repairs.create(body));
export const useUpdateRepair = () =>
  useMasterMutation(({ fix, ...body }: Partial<Repair> & { fix: number }) =>
    api.repairs.update(fix, body)
  );
export const useDeleteRepair = () => useMasterMutation((fix: number) => api.repairs.remove(fix));

/**
 * Every report write can change a day's totals, its status dots and the archive's
 * aggregates, so all report and submitted-day queries are invalidated wholesale
 * rather than surgically. The over-target case is *not* handled here: the server
 * answers a would-be-over-target write with 409 `over_target`, and the grid is
 * what decides whether to confirm and retry with `acknowledgeOverTarget`.
 */
export function useReportMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['reports'] });
    void qc.invalidateQueries({ queryKey: ['submittedDays'] });
  };
  return {
    create: useMutation({ mutationFn: (body: ReportInput) => api.reports.create(body), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: ReportInput & { id: number }) => api.reports.update(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.reports.remove(id), onSuccess: invalidate }),
    submitDay: useMutation({ mutationFn: (date: string) => api.reports.submitDay(date), onSuccess: invalidate }),
  } as const;
}

export function useUserMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.users });
  return {
    create: useMutation({ mutationFn: api.users.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        api.users.update(id, body),
      onSuccess: invalidate,
    }),
    setPassword: useMutation({
      mutationFn: ({ id, password }: { id: number; password: string }) =>
        api.users.setPassword(id, password),
    }),
    remove: useMutation({ mutationFn: api.users.remove, onSuccess: invalidate }),
  } as const;
}

export type { UserAccount };
