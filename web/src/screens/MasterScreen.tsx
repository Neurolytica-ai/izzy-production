import { useMemo, useState, type ReactNode } from 'react';
import type { Role } from '../api/client.ts';
import {
  useBuckets,
  useCreateDepartment,
  useCreateEmployee,
  useCreateProject,
  useCreateRepair,
  useCreateStandard,
  useDeleteDepartment,
  useDeleteEmployee,
  useDeleteProject,
  useDeleteRepair,
  useDeleteStandard,
  useDepartments,
  useEmployees,
  useProjects,
  useRepairs,
  useStandard,
  useUpdateDepartment,
  useUpdateEmployee,
  useUpdateProject,
  useUpdateRepair,
  useUpdateStandard,
} from '../api/hooks.ts';
import { ConfirmDialog, Modal } from '../components/Modal.tsx';
import { RecordForm, type Field } from '../components/RecordForm.tsx';
import { useToast } from '../components/Toast.tsx';

/**
 * WP §6.6 — Master Data.
 *
 * Note on escaping: every value below is rendered as JSX text, so React escapes
 * it. The prototype built each of these tables by concatenating unescaped data
 * into innerHTML, which is harmless in a single-user local page and stored XSS
 * the moment the data is shared between users.
 */

type Entity = 'employees' | 'projects' | 'departments' | 'standard' | 'repairs';

interface Editing {
  entity: Entity;
  record: Record<string, unknown> | null;
}

interface Deleting {
  entity: Entity;
  key: string | number;
  label: string;
}

export function MasterScreen({ role }: { role: Role }) {
  const canWrite = role === 'manager' || role === 'admin';
  const toast = useToast();

  const employees = useEmployees();
  const projects = useProjects();
  const departments = useDepartments();
  const standard = useStandard();
  const repairs = useRepairs();
  const buckets = useBuckets();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  const creators = {
    employees: useCreateEmployee(),
    projects: useCreateProject(),
    departments: useCreateDepartment(),
    standard: useCreateStandard(),
    repairs: useCreateRepair(),
  };
  const updaters = {
    employees: useUpdateEmployee(),
    projects: useUpdateProject(),
    departments: useUpdateDepartment(),
    standard: useUpdateStandard(),
    repairs: useUpdateRepair(),
  };
  const deleters = {
    employees: useDeleteEmployee(),
    projects: useDeleteProject(),
    departments: useDeleteDepartment(),
    standard: useDeleteStandard(),
    repairs: useDeleteRepair(),
  };

  const bucketOptions = useMemo(
    () => (buckets.data ?? []).map((b) => ({ value: b.key, label: `${b.key} — ${b.label_he}` })),
    [buckets.data]
  );

  const FIELDS: Record<Entity, Field[]> = {
    employees: [
      { key: 'num', label: 'Employee number', type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'name', label: 'Full name', required: true },
      { key: 'nick', label: 'Nickname (typed in the grid)', required: true },
      { key: 'contractor', label: 'Subcontractor', hint: 'Leave empty for internal staff' },
      {
        key: 'target_hours',
        label: 'Daily target hours',
        type: 'number',
        hint: 'Leave empty for the default: 10.5 subcontractor / 8.5 internal',
      },
      { key: 'active', label: 'Currently employed', type: 'bool' },
    ],
    projects: [
      { key: 'num', label: 'Project number', type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'name', label: 'Project name', required: true },
      { key: 'nick', label: 'Nickname (typed in the grid)', required: true },
      { key: 'client', label: 'Customer' },
      { key: 'overhead', label: 'Overhead (non-productive)', type: 'bool' },
    ],
    departments: [
      { key: 'name', label: 'Department name', required: true },
      { key: 'num', label: 'Department code', type: 'number' },
      {
        key: 'bucket',
        label: 'Standard-hours bucket',
        type: 'select',
        options: bucketOptions,
        hint: 'Leave empty for non-productive — excluded from standard comparison',
      },
    ],
    standard: [
      { key: 'box', label: 'Box number', type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'name', label: 'Box description' },
      {
        key: 'parent',
        label: 'Parent project',
        type: 'number',
        hint: 'Not validated against projects — 43 existing values reference projects that do not exist',
      },
      { key: 'total', label: 'Total standard hours', type: 'number' },
    ],
    repairs: [
      { key: 'fix', label: 'Repair number', type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'client', label: 'Customer' },
      { key: 'date', label: 'Entry date', type: 'date' },
      { key: 'model', label: 'Truck model' },
    ],
  };

  const KEY_OF: Record<Entity, string> = {
    employees: 'num',
    projects: 'num',
    departments: 'name',
    standard: 'box',
    repairs: 'fix',
  };

  const save = async (entity: Entity, values: Record<string, unknown>) => {
    const keyField = KEY_OF[entity];
    if (editing?.record) {
      const key = editing.record[keyField];
      await (updaters[entity].mutateAsync as (v: unknown) => Promise<unknown>)({
        ...values,
        [keyField]: key,
      });
      toast.show('Saved');
      setEditing(null);
    } else {
      await (creators[entity].mutateAsync as (v: unknown) => Promise<unknown>)(values);
      toast.show('Added');
      setEditing(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await (deleters[deleting.entity].mutateAsync as (k: unknown) => Promise<unknown>)(
        deleting.key
      );
      toast.show('Deleted');
      setDeleting(null);
    } catch (err) {
      // The common case is a 409: rows still reference this record. WP §4.10
      // blocks the delete rather than cascading history away, so the message the
      // server sends is the useful one.
      toast.show(err instanceof Error ? err.message : 'Delete failed', 'error');
      setDeleting(null);
    }
  };

  const actions = (entity: Entity, key: string | number, label: string, record: object) =>
    canWrite ? (
      <>
        <button
          className="delm"
          style={{ color: '#2e5496' }}
          title="Edit"
          onClick={() => setEditing({ entity, record: record as Record<string, unknown> })}
        >
          ✏️
        </button>
        <button className="delm" title="Delete" onClick={() => setDeleting({ entity, key, label })}>
          🗑
        </button>
      </>
    ) : null;

  const activeEmployees = (employees.data ?? []).filter((e) => e.active);
  const productive = (projects.data ?? []).filter((p) => !p.overhead);
  const clients = new Set(productive.map((p) => p.client));

  return (
    <>
      <div className="row">
        <Kpi value={`${activeEmployees.length} / ${employees.data?.length ?? 0}`} label="Active employees" />
        <Kpi value={productive.length} label="Productive projects" />
        <Kpi value={clients.size} label="Customers" />
        <Kpi value={standard.data?.length ?? 0} label="Standard-hours boxes" />
        <Kpi value={repairs.data?.length ?? 0} label="Repair tickets" />
      </div>

      {!canWrite && (
        <div className="card">
          <div className="mini">
            Your role is <b>{role}</b>, which can view master data but not change it (WP §8). Editing
            requires manager or admin.
          </div>
        </div>
      )}

      <Section
        title="Employees"
        count={employees.data?.length}
        query={employees}
        onAdd={canWrite ? () => setEditing({ entity: 'employees', record: null }) : undefined}
        addLabel="Add employee"
      >
        <table className="xl" style={{ fontSize: 12.5, minWidth: 620 }}>
          <thead>
            <tr>
              <th>Number</th>
              <th style={{ textAlign: 'start' }}>Name</th>
              <th>Nickname</th>
              <th>Subcontractor</th>
              <th>Target</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(employees.data ?? []).map((e) => (
              <tr key={e.num}>
                <td className="derived">{e.num}</td>
                <td className="derived" style={{ textAlign: 'start' }}>
                  {e.name}
                  {!e.active && <span className="mini"> (not employed)</span>}
                </td>
                <td className="derived">{e.nick}</td>
                <td className="derived">{e.contractor ?? 'internal'}</td>
                <td className="derived">
                  {e.effective_target}
                  {e.target_hours === null && <span className="mini"> (default)</span>}
                </td>
                <td className="actcell">{actions('employees', e.num, `${e.name} (${e.num})`, e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Projects"
        count={projects.data?.length}
        query={projects}
        onAdd={canWrite ? () => setEditing({ entity: 'projects', record: null }) : undefined}
        addLabel="Add project"
      >
        <table className="xl" style={{ fontSize: 12.5, minWidth: 680 }}>
          <thead>
            <tr>
              <th>Number</th>
              <th style={{ textAlign: 'start' }}>Name</th>
              <th>Nickname</th>
              <th>Customer</th>
              <th>Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(projects.data ?? []).map((p) => (
              <tr key={p.num}>
                <td className="derived">{p.num}</td>
                <td className="derived" style={{ textAlign: 'start' }} title={p.name}>
                  {p.name.length > 52 ? `${p.name.slice(0, 52)}…` : p.name}
                </td>
                <td className="derived">{p.nick}</td>
                <td className="derived">{p.client}</td>
                <td className="derived">
                  <span className={`pill ${p.overhead ? 'y' : 'g'}`}>
                    {p.overhead ? 'overhead' : 'productive'}
                  </span>
                </td>
                <td className="actcell">{actions('projects', p.num, `${p.name} (${p.num})`, p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="row">
        <div style={{ flex: 1, minWidth: 320 }}>
          <Section
            title="Departments"
            count={departments.data?.length}
            query={departments}
            onAdd={canWrite ? () => setEditing({ entity: 'departments', record: null }) : undefined}
            addLabel="Add department"
          >
            <table className="xl" style={{ fontSize: 12.5, minWidth: 300 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>Department</th>
                  <th>Code</th>
                  <th>Bucket</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(departments.data ?? []).map((d) => (
                  <tr key={d.name}>
                    <td className="derived" style={{ textAlign: 'start' }}>
                      {d.name}
                    </td>
                    <td className="derived">{d.num ?? '—'}</td>
                    <td className="derived">
                      {d.bucket ?? <span className="mini">non-productive</span>}
                    </td>
                    <td className="actcell">{actions('departments', d.name, d.name, d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>

        <div style={{ flex: 1, minWidth: 320 }}>
          <Section
            title="Repairs"
            count={repairs.data?.length}
            query={repairs}
            onAdd={canWrite ? () => setEditing({ entity: 'repairs', record: null }) : undefined}
            addLabel="Add repair"
          >
            <table className="xl" style={{ fontSize: 12.5, minWidth: 320 }}>
              <thead>
                <tr>
                  <th>Number</th>
                  <th style={{ textAlign: 'start' }}>Customer</th>
                  <th>Date</th>
                  <th>Model</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(repairs.data ?? []).map((r) => (
                  <tr key={r.fix}>
                    <td className="derived">{r.fix}</td>
                    <td className="derived" style={{ textAlign: 'start' }}>
                      {r.client}
                    </td>
                    <td className="derived">
                      <span dir="ltr">{r.date ?? '—'}</span>
                    </td>
                    <td className="derived">{r.model ?? '—'}</td>
                    <td className="actcell">{actions('repairs', r.fix, `repair ${r.fix}`, r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      <Section
        title="Standard hours"
        count={standard.data?.length}
        query={standard}
        onAdd={canWrite ? () => setEditing({ entity: 'standard', record: null }) : undefined}
        addLabel="Add box"
        note={<OrphanNote boxes={standard.data ?? []} projectNums={new Set((projects.data ?? []).map((p) => p.num))} />}
      >
        <div style={{ maxHeight: 380, overflow: 'auto' }}>
          <table className="xl" style={{ fontSize: 12, minWidth: 520 }}>
            <thead>
              <tr>
                <th>Box</th>
                <th style={{ textAlign: 'start' }}>Description</th>
                <th>Parent</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(standard.data ?? []).map((s) => (
                <tr key={s.box}>
                  <td className="derived">{s.box}</td>
                  <td className="derived" style={{ textAlign: 'start' }} title={s.name}>
                    {s.name.length > 46 ? `${s.name.slice(0, 46)}…` : s.name}
                  </td>
                  <td className="derived">{s.parent ?? '—'}</td>
                  <td className="derived">
                    <b>{s.total}</b>
                  </td>
                  <td className="actcell">{actions('standard', s.box, `box ${s.box}`, s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {editing && (
        <Modal
          title={
            editing.record
              ? `Edit ${LABEL[editing.entity]}`
              : `Add ${LABEL[editing.entity]}`
          }
          onClose={() => setEditing(null)}
        >
          <RecordForm
            fields={FIELDS[editing.entity]}
            record={editing.record}
            submitLabel={editing.record ? 'Save' : 'Add'}
            onCancel={() => setEditing(null)}
            onSubmit={(values) => save(editing.entity, values)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete ${deleting.label}?`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
          busy={deleters[deleting.entity].isPending}
        />
      )}

      {toast.node}
    </>
  );
}

const LABEL: Record<Entity, string> = {
  employees: 'employee',
  projects: 'project',
  departments: 'department',
  standard: 'standard-hours box',
  repairs: 'repair',
};

function Kpi({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="kpi">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

interface QueryLike {
  isLoading: boolean;
  error: unknown;
}

function Section({
  title,
  count,
  query,
  onAdd,
  addLabel,
  note,
  children,
}: {
  title: string;
  count: number | undefined;
  query: QueryLike;
  onAdd?: (() => void) | undefined;
  addLabel?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {title} {count !== undefined && <span className="mini">({count})</span>}
        </div>
        <div style={{ flex: 1 }} />
        {onAdd && (
          <button className="btn sm grn" onClick={onAdd}>
            ＋ {addLabel}
          </button>
        )}
      </div>
      {note}
      {query.isLoading ? (
        <div className="empty">Loading…</div>
      ) : query.error ? (
        <div className="empty" style={{ color: '#c33' }}>
          {query.error instanceof Error ? query.error.message : 'Failed to load'}
        </div>
      ) : count === 0 ? (
        <div className="empty">Nothing here yet</div>
      ) : (
        <div className="xl-scroll" style={{ maxHeight: 360 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Surfaces the orphan-parent problem where someone can act on it, rather than
 * leaving it buried in a view nobody queries. See docs/OPEN-QUESTIONS.md #1.
 */
function OrphanNote({
  boxes,
  projectNums,
}: {
  boxes: { parent: number | null; total: number }[];
  projectNums: Set<number>;
}) {
  if (boxes.length === 0 || projectNums.size === 0) return null;
  const orphans = boxes.filter((b) => b.parent !== null && !projectNums.has(b.parent));
  if (orphans.length === 0) return null;
  const distinct = new Set(orphans.map((b) => b.parent)).size;
  const hours = orphans.reduce((s, b) => s + b.total, 0);
  return (
    <div className="pill y" style={{ display: 'block', padding: '8px 12px', marginBottom: 10 }}>
      {orphans.length} of {boxes.length} boxes reference {distinct} parent projects that do not exist
      ({hours.toLocaleString()} standard hours). These are invisible to budget-vs-actual.
    </div>
  );
}
