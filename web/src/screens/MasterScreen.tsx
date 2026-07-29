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
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

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

/** Entity → its singular label key, for the Add/Edit modal titles. */
const ENTITY_LABEL: Record<Entity, StringKey> = {
  employees: 'entity.employee',
  projects: 'entity.project',
  departments: 'entity.department',
  standard: 'entity.standardBox',
  repairs: 'entity.repair',
};

export function MasterScreen({ role }: { role: Role }) {
  const t = useT();
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
      { key: 'num', label: t('field.emp.num'), type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'name', label: t('field.emp.name'), required: true },
      { key: 'nick', label: t('field.emp.nick'), required: true },
      { key: 'contractor', label: t('field.emp.contractor'), hint: t('field.emp.contractorHint') },
      {
        key: 'target_hours',
        label: t('field.emp.target'),
        type: 'number',
        hint: t('field.emp.targetHint'),
      },
      { key: 'active', label: t('field.emp.active'), type: 'bool' },
    ],
    projects: [
      { key: 'num', label: t('field.proj.num'), type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'name', label: t('field.proj.name'), required: true },
      { key: 'nick', label: t('field.proj.nick'), required: true },
      { key: 'client', label: t('field.proj.client') },
      { key: 'overhead', label: t('field.proj.overhead'), type: 'bool' },
    ],
    departments: [
      { key: 'name', label: t('field.dept.name'), required: true },
      { key: 'num', label: t('field.dept.num'), type: 'number' },
      {
        key: 'bucket',
        label: t('field.dept.bucket'),
        type: 'select',
        options: bucketOptions,
        hint: t('field.dept.bucketHint'),
      },
    ],
    standard: [
      { key: 'box', label: t('field.std.box'), type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'name', label: t('field.std.name') },
      {
        key: 'parent',
        label: t('field.std.parent'),
        type: 'number',
        hint: t('field.std.parentHint'),
      },
      { key: 'total', label: t('field.std.total'), type: 'number' },
    ],
    repairs: [
      { key: 'fix', label: t('field.rep.fix'), type: 'number', required: true, readOnlyOnEdit: true },
      { key: 'client', label: t('field.rep.client') },
      { key: 'date', label: t('field.rep.date'), type: 'date' },
      { key: 'model', label: t('field.rep.model') },
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
      toast.show(t('common.saved'));
      setEditing(null);
    } else {
      await (creators[entity].mutateAsync as (v: unknown) => Promise<unknown>)(values);
      toast.show(t('common.added'));
      setEditing(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await (deleters[deleting.entity].mutateAsync as (k: unknown) => Promise<unknown>)(
        deleting.key
      );
      toast.show(t('common.deleted'));
      setDeleting(null);
    } catch (err) {
      // The common case is a 409: rows still reference this record. WP §4.10
      // blocks the delete rather than cascading history away, so the message the
      // server sends is the useful one.
      toast.show(err instanceof Error ? err.message : t('common.deleteFailed'), 'error');
      setDeleting(null);
    }
  };

  const actions = (entity: Entity, key: string | number, label: string, record: object) =>
    canWrite ? (
      <>
        <button
          className="delm"
          style={{ color: '#2e5496' }}
          title={t('common.edit')}
          onClick={() => setEditing({ entity, record: record as Record<string, unknown> })}
        >
          ✏️
        </button>
        <button className="delm" title={t('common.delete')} onClick={() => setDeleting({ entity, key, label })}>
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
        <Kpi value={`${activeEmployees.length} / ${employees.data?.length ?? 0}`} label={t('master.kpi.activeEmployees')} />
        <Kpi value={productive.length} label={t('master.kpi.productiveProjects')} />
        <Kpi value={clients.size} label={t('master.kpi.customers')} />
        <Kpi value={standard.data?.length ?? 0} label={t('master.kpi.standardBoxes')} />
        <Kpi value={repairs.data?.length ?? 0} label={t('master.kpi.repairTickets')} />
      </div>

      {!canWrite && (
        <div className="card">
          <div className="mini">{t('master.roleNote', { role })}</div>
        </div>
      )}

      <Section
        title={t('master.section.employees')}
        count={employees.data?.length}
        query={employees}
        onAdd={canWrite ? () => setEditing({ entity: 'employees', record: null }) : undefined}
        addLabel={t('master.add.employee')}
      >
        <table className="xl" style={{ fontSize: 12.5, minWidth: 620 }}>
          <thead>
            <tr>
              <th>{t('th.number')}</th>
              <th style={{ textAlign: 'start' }}>{t('th.name')}</th>
              <th>{t('th.nickname')}</th>
              <th>{t('th.subcontractor')}</th>
              <th>{t('th.target')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(employees.data ?? []).map((e) => (
              <tr key={e.num}>
                <td className="derived">{e.num}</td>
                <td className="derived" style={{ textAlign: 'start' }}>
                  {e.name}
                  {!e.active && <span className="mini"> {t('master.notEmployed')}</span>}
                </td>
                <td className="derived">{e.nick}</td>
                <td className="derived">{e.contractor ?? t('master.internal')}</td>
                <td className="derived">
                  {e.effective_target}
                  {e.target_hours === null && <span className="mini"> {t('master.default')}</span>}
                </td>
                <td className="actcell">{actions('employees', e.num, `${e.name} (${e.num})`, e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title={t('master.section.projects')}
        count={projects.data?.length}
        query={projects}
        onAdd={canWrite ? () => setEditing({ entity: 'projects', record: null }) : undefined}
        addLabel={t('master.add.project')}
      >
        <table className="xl" style={{ fontSize: 12.5, minWidth: 680 }}>
          <thead>
            <tr>
              <th>{t('th.number')}</th>
              <th style={{ textAlign: 'start' }}>{t('th.name')}</th>
              <th>{t('th.nickname')}</th>
              <th>{t('th.customer')}</th>
              <th>{t('th.type')}</th>
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
                    {p.overhead ? t('master.overhead') : t('master.productive')}
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
            title={t('master.section.departments')}
            count={departments.data?.length}
            query={departments}
            onAdd={canWrite ? () => setEditing({ entity: 'departments', record: null }) : undefined}
            addLabel={t('master.add.department')}
          >
            <table className="xl" style={{ fontSize: 12.5, minWidth: 300 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>{t('th.department')}</th>
                  <th>{t('th.code')}</th>
                  <th>{t('th.bucket')}</th>
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
                      {d.bucket ?? <span className="mini">{t('master.nonProductive')}</span>}
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
            title={t('master.section.repairs')}
            count={repairs.data?.length}
            query={repairs}
            onAdd={canWrite ? () => setEditing({ entity: 'repairs', record: null }) : undefined}
            addLabel={t('master.add.repair')}
          >
            <table className="xl" style={{ fontSize: 12.5, minWidth: 320 }}>
              <thead>
                <tr>
                  <th>{t('th.number')}</th>
                  <th style={{ textAlign: 'start' }}>{t('th.customer')}</th>
                  <th>{t('th.date')}</th>
                  <th>{t('th.model')}</th>
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
                    <td className="actcell">{actions('repairs', r.fix, `${t('entity.repair')} ${r.fix}`, r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      <Section
        title={t('master.section.standard')}
        count={standard.data?.length}
        query={standard}
        onAdd={canWrite ? () => setEditing({ entity: 'standard', record: null }) : undefined}
        addLabel={t('master.add.box')}
        note={<OrphanNote boxes={standard.data ?? []} projectNums={new Set((projects.data ?? []).map((p) => p.num))} />}
      >
        <div style={{ maxHeight: 380, overflow: 'auto' }}>
          <table className="xl" style={{ fontSize: 12, minWidth: 520 }}>
            <thead>
              <tr>
                <th>{t('th.box')}</th>
                <th style={{ textAlign: 'start' }}>{t('th.description')}</th>
                <th>{t('th.parent')}</th>
                <th>{t('th.total')}</th>
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
                  <td className="actcell">{actions('standard', s.box, `${t('th.box')} ${s.box}`, s)}</td>
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
              ? t('master.editTitle', { label: t(ENTITY_LABEL[editing.entity]) })
              : t('master.addTitle', { label: t(ENTITY_LABEL[editing.entity]) })
          }
          onClose={() => setEditing(null)}
        >
          <RecordForm
            fields={FIELDS[editing.entity]}
            record={editing.record}
            submitLabel={editing.record ? t('common.save') : t('common.add')}
            onCancel={() => setEditing(null)}
            onSubmit={(values) => save(editing.entity, values)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={t('master.deleteConfirm', { label: deleting.label })}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
          busy={deleters[deleting.entity].isPending}
        />
      )}

      {toast.node}
    </>
  );
}

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
  const t = useT();
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
        <div className="empty">{t('common.loading')}</div>
      ) : query.error ? (
        <div className="empty" style={{ color: '#c33' }}>
          {query.error instanceof Error ? query.error.message : t('common.failedToLoad')}
        </div>
      ) : count === 0 ? (
        <div className="empty">{t('master.nothingHere')}</div>
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
  const t = useT();
  if (boxes.length === 0 || projectNums.size === 0) return null;
  const orphans = boxes.filter((b) => b.parent !== null && !projectNums.has(b.parent));
  if (orphans.length === 0) return null;
  const distinct = new Set(orphans.map((b) => b.parent)).size;
  const hours = orphans.reduce((s, b) => s + b.total, 0);
  return (
    <div className="pill y" style={{ display: 'block', padding: '8px 12px', marginBottom: 10 }}>
      {t('master.orphan', {
        orphans: orphans.length,
        boxes: boxes.length,
        distinct,
        hours: hours.toLocaleString(),
      })}
    </div>
  );
}