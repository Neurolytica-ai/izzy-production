import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  exportUrl,
  type Department,
  type Employee,
  type Project,
  type Repair,
  type ReportInput,
  type ReportRow,
} from '../api/client.ts';
import { useEmployees, useReportMutations, useReports, useSubmittedDays } from '../api/hooks.ts';
import { AutocompleteCell, type AcSuggestion } from '../components/AutocompleteCell.tsx';
import { ConfirmDialog } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { useT } from '../i18n/index.tsx';

/**
 * WP §6, §7.3 — the Excel-style hours-entry grid, the system's most-used screen
 * and the highest-risk thing to port. It reproduces the prototype's ergonomics
 * (`renderGrid`/`setupAC`/`finalizeDraft`/`saveExisting`, :367-535): a permanent
 * draft row at the bottom, autocomplete cells, keyboard traversal, live derived
 * columns and status dots, and the over-target confirmation.
 *
 * What changes for a multi-user server: resolution and the over-target rule are
 * the server's job, not the browser's. A create/update sends what the user typed;
 * the server resolves it and is the only thing that decides "over target". The
 * grid shows an optimistic derived preview from the autocomplete pick, then lets
 * the authoritative row from the response (via query invalidation) replace it.
 */

type StatusColor = 'g' | 'y' | 'r';

/** One editable grid row. `id === null` is the always-present draft row. */
interface GridModel {
  id: number | null;
  date: string;
  empText: string;
  emp_num: number | null;
  emp_name: string;
  projText: string;
  proj_num: number | null;
  proj_name: string | null;
  hours: string;
  deptText: string;
  dept_num: number | null;
  fixText: string;
  fix: number | null;
  unresolved: string[];
}

function todayISO(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function emptyDraft(date: string): GridModel {
  return {
    id: null,
    date,
    empText: '',
    emp_num: null,
    emp_name: '',
    projText: '',
    proj_num: null,
    proj_name: null,
    hours: '',
    deptText: '',
    dept_num: null,
    fixText: '',
    fix: null,
    unresolved: [],
  };
}

function fromRow(r: ReportRow): GridModel {
  return {
    id: r.id,
    date: r.date,
    empText: r.emp_nick,
    emp_num: r.emp_num,
    emp_name: r.emp_name,
    projText: r.proj_nick ?? '',
    proj_num: r.proj_num,
    // display_proj_name covers repairs too ("תיקון <n> · <client>"), so a ticket
    // row names its customer like a project row does (client feedback #6).
    proj_name: r.display_proj_name || r.proj_name,
    hours: String(r.hours),
    deptText: r.dept,
    dept_num: r.dept_num,
    fixText: r.fix == null ? '' : String(r.fix),
    fix: r.fix,
    unresolved: [],
  };
}

/** Build the create/update payload, sending resolved keys where known and the
 *  typed text otherwise. Undefined keys are omitted so a partial edit never
 *  clears a field it did not touch (and exactOptionalPropertyTypes is satisfied). */
function toInput(m: GridModel): ReportInput {
  const emp = m.emp_num ?? (m.empText.trim() || undefined);
  const hours = m.hours.trim() === '' ? undefined : Number(m.hours);
  const out: ReportInput = {
    date: m.date,
    dept: m.deptText.trim(),
    proj: m.proj_num ?? (m.projText.trim() || null),
    fix: m.fix ?? (m.fixText.trim() || null),
  };
  if (emp !== undefined) out.emp = emp;
  if (hours !== undefined) out.hours = hours;
  return out;
}

/* --------------------------------------------------------- search adapters */

const empSuggest = (q: string): Promise<AcSuggestion<Employee>[]> =>
  api.lookup.employees(q).then((rows) =>
    rows.map((e) => ({ main: e.nick, sub: `${e.name} · ${e.num}`, value: e }))
  );

const projSuggest = (q: string): Promise<AcSuggestion<Project>[]> =>
  api.lookup.projects(q).then((rows) =>
    rows.map((p) => ({ main: p.nick, sub: `${p.name.slice(0, 38)} (${p.num})`, value: p }))
  );

const deptSuggest = (q: string): Promise<AcSuggestion<Department & { bucket_label: string | null }>[]> =>
  api.lookup.departments(q).then((rows) =>
    rows.map((d) => ({ main: d.name, sub: d.num == null ? '—' : `${d.num}`, value: d }))
  );

const fixSuggest = (q: string): Promise<AcSuggestion<Repair>[]> =>
  api.lookup.repairs(q).then((rows) =>
    rows.map((r) => ({ main: String(r.fix), sub: `${r.client ?? ''} · ${r.date ?? ''}`, value: r }))
  );

/* --------------------------------------------------------------- the screen */

export function ReportScreen() {
  const t = useT();
  const toast = useToast();
  const [date, setDate] = useState(todayISO);
  const [showAll, setShowAll] = useState(false);

  const reports = useReports(
    showAll
      ? { limit: 1000, sort: 'date', dir: 'desc' }
      : { date, limit: 1000, sort: 'emp_nick', dir: 'asc' }
  );
  const employees = useEmployees(true);
  const submitted = useSubmittedDays({ from: date, to: date });
  const mut = useReportMutations();

  // The draft row's date follows the selected date while the user has not typed
  // into it, matching the prototype (renderGrid, :368).
  const [draft, setDraft] = useState<GridModel>(() => emptyDraft(date));
  useEffect(() => {
    setDraft((d) => (d.empText || d.projText || d.hours || d.deptText || d.fixText ? d : emptyDraft(date)));
  }, [date]);

  // commitDraft can be invoked from a stale closure (a suggestion pick defers the
  // commit past its own state update), so it must read the draft through a ref —
  // committing the pre-pick draft is what made a ticket-only row look like it
  // "required a project" (client feedback #5, #7).
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [confirm, setConfirm] = useState<
    { message: string; onConfirm: () => void; onCancel?: (() => void) | undefined } | null
  >(null);

  const rows = reports.data?.data ?? [];

  /** Per-employee reported hours for the selected date, from the loaded rows. */
  const statusOf = useMemo(() => {
    const byEmp = new Map<number, number>();
    if (!showAll) {
      for (const r of rows) byEmp.set(r.emp_num, (byEmp.get(r.emp_num) ?? 0) + Number(r.hours));
    }
    const targetOf = new Map<number, number>();
    for (const e of employees.data ?? []) targetOf.set(e.num, e.effective_target);
    return (empNum: number | null): StatusColor | null => {
      if (empNum == null || showAll) return null;
      const h = byEmp.get(empNum) ?? 0;
      const tgt = targetOf.get(empNum) ?? 0;
      if (h <= 0) return 'r';
      return h >= tgt - 0.001 ? 'g' : 'y';
    };
  }, [rows, employees.data, showAll]);

  const dayStatus = useMemo(() => {
    let g = 0, y = 0, r = 0;
    for (const e of employees.data ?? []) {
      const s = statusOf(e.num);
      if (s === 'g') g++;
      else if (s === 'y') y++;
      else r++;
    }
    return { g, y, r };
  }, [employees.data, statusOf]);

  const isSubmitted = (submitted.data ?? []).some((s) => s.date === date);

  /**
   * Runs a report write and, on a 409 `over_target`, surfaces the server's
   * confirmation instead of failing. The retry re-sends the same input with the
   * acknowledgement flag — the server stays the single arbiter of the rule
   * (WP §5.6), the client only relays the yes/no.
   */
  async function writeWithOverTarget(
    run: (ack: boolean) => Promise<unknown>,
    onDone: () => void,
    // Called on any outcome that did NOT persist — a terminal error, or the user
    // declining the over-target confirmation. The caller uses it to roll back its
    // optimistic "already saved" bookkeeping so the write can be retried.
    onFail?: () => void
  ): Promise<void> {
    try {
      await run(false);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'over_target') {
        setConfirm({
          message: err.message,
          onConfirm: () => {
            setConfirm(null);
            void run(true)
              .then(onDone)
              .catch((e) => {
                onFail?.();
                toast.show(e instanceof Error ? e.message : t('common.saveFailed'), 'error');
              });
          },
          onCancel: onFail,
        });
        return;
      }
      onFail?.();
      if (err instanceof ApiError && err.code === 'unresolved') {
        // Name the fields that failed to resolve — a bare "invalid input" left
        // users stuck with no idea what to correct (client feedback #7).
        const un = (err.details as unknown as { unresolved?: string[] } | undefined)?.unresolved ?? [];
        const labels: Record<string, string> = {
          emp: t('aria.employee'),
          proj: t('aria.project'),
          dept: t('aria.department'),
          fix: t('aria.repairNo'),
        };
        const fields = un.map((f) => labels[f] ?? f).join(', ');
        toast.show(fields ? t('report.notIdentifiedIn', { fields }) : err.message, 'error');
        return;
      }
      toast.show(err instanceof Error ? err.message : t('common.saveFailed'), 'error');
    }
  }

  const commitDraft = () => {
    const d = draftRef.current;
    // A half-edited date input yields '' — sent as-is the server answers a bare
    // "invalid input" and the user is stuck (client feedback #7, the red toast
    // in the screenshot). Catch it here with a message that names the problem.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      toast.show(t('report.badDate'), 'error');
      return;
    }
    const complete = d.empText.trim() && (d.projText.trim() || d.fixText.trim()) && d.hours.trim();
    if (!complete) {
      toast.show(t('report.required'), 'error');
      return;
    }
    void writeWithOverTarget(
      (ack) => mut.create.mutateAsync({ ...toInput(d), acknowledgeOverTarget: ack }),
      () => {
        toast.show(t('common.added'));
        setDraft(emptyDraft(d.date));
        // Return focus to the top of the fresh draft row.
        setTimeout(() => {
          document
            .querySelector<HTMLInputElement>('tr.draft [data-grid-input]')
            ?.focus();
        }, 20);
      }
    );
  };

  const saveExisting = (m: GridModel, onError: () => void) => {
    if (m.id == null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) {
      onError();
      toast.show(t('report.badDate'), 'error');
      return;
    }
    void writeWithOverTarget(
      (ack) => mut.update.mutateAsync({ id: m.id!, ...toInput(m), acknowledgeOverTarget: ack }),
      () => toast.show(t('common.saved')),
      onError
    );
  };

  const submitDay = () => {
    if (rows.length === 0) {
      toast.show(t('report.nothingToSubmit'), 'error');
      return;
    }
    void mut.submitDay
      .mutateAsync(date)
      .then((r) => toast.show(t('report.daySubmitted', { n: r.row_count })))
      .catch((e) => toast.show(e instanceof Error ? e.message : t('report.submitFailed'), 'error'));
  };

  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <label>
            {t('report.th.date')}{' '}
            <input
              type="date"
              value={date}
              disabled={showAll}
              onChange={(e) => setDate(e.target.value)}
              dir="ltr"
            />
          </label>
          <button
            className={`btn sm ${showAll ? '' : 'ghost'}`}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? t('report.showOneDay') : t('report.allDates')}
          </button>
          <div style={{ flex: 1 }} />
          <a
            className="btn sm ghost"
            href={exportUrl('report', showAll ? {} : { date })}
            download
          >
            {t('common.exportExcel')}
          </a>
          {!showAll && (
            <button className="btn sm grn" onClick={submitDay} disabled={mut.submitDay.isPending}>
              {t('report.submitDay')}
            </button>
          )}
        </div>

        <div className="mini" style={{ marginBottom: 8 }}>
          {showAll ? (
            <b>{t('report.rowsAllDates', { n: reports.data?.meta.totalRows ?? rows.length })}</b>
          ) : (
            <>
              <span className="dot g" />
              {dayStatus.g} {t('report.complete')} &nbsp;
              <span className="dot y" />
              {dayStatus.y} {t('report.partial')} &nbsp;
              <span className="dot r" />
              {dayStatus.r} {t('report.notReported')}
              {isSubmitted && <span className="badge-new" style={{ marginInlineStart: 8 }}>{t('report.submitted')}</span>}
            </>
          )}
        </div>

        {reports.error ? (
          <div className="empty" style={{ color: '#c33' }}>
            {reports.error instanceof Error ? reports.error.message : t('common.failedToLoad')}
          </div>
        ) : (
          <div className="xl-scroll">
            <table className="xl">
              <thead>
                <tr>
                  <th style={{ minWidth: 110 }}>{t('report.th.date')}</th>
                  <th style={{ minWidth: 100 }}>{t('report.th.employee')}</th>
                  {/* Ticket sits right next to Project (client feedback #2) — the
                      pair is an either/or choice and reads as one. */}
                  <th style={{ minWidth: 130 }}>{t('report.th.project')}</th>
                  <th style={{ minWidth: 90 }}>{t('report.th.repairNo')}</th>
                  <th style={{ minWidth: 80 }}>{t('report.th.hours')}</th>
                  <th style={{ minWidth: 110 }}>{t('report.th.department')}</th>
                  <th className="derived-h" style={{ minWidth: 80 }}>{t('report.th.projNo')}</th>
                  <th className="derived-h" style={{ minWidth: 190 }}>{t('report.th.projName')}</th>
                  <th className="derived-h" style={{ minWidth: 70 }}>{t('report.th.empNo')}</th>
                  <th className="derived-h" style={{ minWidth: 70 }}>{t('report.th.deptNo')}</th>
                  <th className="derived-h" style={{ minWidth: 130 }}>{t('report.th.empName')}</th>
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowEditor
                    key={r.id}
                    mode="existing"
                    seed={r}
                    statusOf={statusOf}
                    onSave={saveExisting}
                    onDelete={(id) =>
                      setConfirm({
                        message: t('report.deleteRow', { emp: r.emp_nick, hours: Number(r.hours), date: r.date }),
                        onConfirm: () => {
                          setConfirm(null);
                          void mut.remove
                            .mutateAsync(id)
                            .then(() => toast.show(t('common.deleted')))
                            .catch((e) =>
                              toast.show(e instanceof Error ? e.message : t('common.deleteFailed'), 'error')
                            );
                        },
                      })
                    }
                  />
                ))}

                {!showAll && (
                  <RowEditor
                    mode="draft"
                    draft={draft}
                    setDraft={setDraft}
                    statusOf={statusOf}
                    onCommit={commitDraft}
                  />
                )}
              </tbody>
            </table>
            {reports.isLoading && <div className="empty">{t('common.loading')}</div>}
            {!reports.isLoading && rows.length === 0 && !showAll && (
              <div className="mini" style={{ padding: '8px 4px' }}>
                {t('report.noRowsHint')}
              </div>
            )}
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel={t('common.confirm')}
          onConfirm={confirm.onConfirm}
          onCancel={() => {
            confirm.onCancel?.();
            setConfirm(null);
          }}
        />
      )}

      {toast.node}
    </>
  );
}

/* --------------------------------------------------------------- the row */

type RowProps =
  | {
      mode: 'existing';
      seed: ReportRow;
      statusOf: (empNum: number | null) => StatusColor | null;
      onSave: (m: GridModel, onError: () => void) => void;
      onDelete: (id: number) => void;
    }
  | {
      mode: 'draft';
      draft: GridModel;
      setDraft: React.Dispatch<React.SetStateAction<GridModel>>;
      statusOf: (empNum: number | null) => StatusColor | null;
      onCommit: () => void;
    };

function RowEditor(props: RowProps) {
  const t = useT();
  const isDraft = props.mode === 'draft';

  /** A ticket's display name, shaped like the server's display_proj_name. */
  const repairName = (n: number, client: string | null | undefined) =>
    t('report.repairLabel', { n }) + (client ? ` · ${client}` : '');

  // Existing rows keep a local editable copy, re-seeded when the server row
  // changes (id + hours + updated key), so an external refetch does not clobber
  // an edit in progress but a real change downstream is picked up.
  const [local, setLocal] = useState<GridModel>(() =>
    isDraft ? props.draft : fromRow(props.seed)
  );
  const seedKey = isDraft ? '' : `${props.seed.id}:${props.seed.updated_at}:${props.seed.hours}`;
  const lastSeed = useRef(seedKey);

  // The last payload we persisted, so tabbing through an unchanged row does not
  // fire a pointless update (which the server would otherwise log as an edit).
  const savedRef = useRef<string>(isDraft ? '' : JSON.stringify(toInput(fromRow(props.seed))));

  useEffect(() => {
    if (!isDraft && seedKey !== lastSeed.current) {
      lastSeed.current = seedKey;
      const fresh = fromRow((props as Extract<RowProps, { mode: 'existing' }>).seed);
      setLocal(fresh);
      savedRef.current = JSON.stringify(toInput(fresh));
    }
  }, [isDraft, seedKey, props]);

  const model = isDraft ? props.draft : local;
  const update = (patch: Partial<GridModel>) => {
    if (isDraft) props.setDraft((d) => ({ ...d, ...patch }));
    else setLocal((m) => ({ ...m, ...patch }));
  };

  // Blur handlers fire from a timeout inside the cell, so their captured closure
  // can lag a render behind. Reading the model through a ref keeps save and
  // reconcile working off the latest values regardless.
  const modelRef = useRef(model);
  modelRef.current = model;

  /** Reconcile the derived columns for whatever the user typed but did not pick
   *  (e.g. Tab-out of an exact nickname). Uses the same server resolver the save
   *  will use, so the preview cannot disagree with what gets stored. */
  const reconcile = () => {
    const m = modelRef.current;
    if (!m.empText.trim() && !m.projText.trim() && !m.deptText.trim() && !m.fixText.trim()) return;
    void api.lookup
      .resolve({
        emp: m.empText.trim() || (m.emp_num != null ? String(m.emp_num) : null),
        proj: m.projText.trim() || (m.proj_num != null ? String(m.proj_num) : null),
        dept: m.deptText.trim() || null,
        fix: m.fixText.trim() || (m.fix != null ? String(m.fix) : null),
      })
      .then((res) => {
        update({
          emp_num: res.employee?.emp_num ?? null,
          emp_name: res.employee?.emp_name ?? '',
          proj_num: res.project?.proj_num ?? null,
          proj_name:
            res.project?.proj_name ??
            (res.repair ? repairName(res.repair.fix, res.repair.client) : null),
          dept_num: res.department?.dept_num ?? null,
          fix: res.repair?.fix ?? null,
          unresolved: res.unresolved,
        });
      })
      .catch(() => {
        /* a resolution preview failure is not worth interrupting entry over */
      });
  };

  const saveIfExisting = () => {
    if (isDraft) return;
    const payload = JSON.stringify(toInput(modelRef.current));
    if (payload === savedRef.current) return; // nothing changed since last save
    // Optimistically record it as saved so tabbing on through the row's other
    // cells does not re-fire the same write; roll back if the save does not land
    // (error, or the user declines the over-target prompt) so it can be retried.
    const previous = savedRef.current;
    savedRef.current = payload;
    (props as Extract<RowProps, { mode: 'existing' }>).onSave(modelRef.current, () => {
      savedRef.current = previous;
    });
  };

  const onEnterEnd = () => {
    if (isDraft) props.onCommit();
  };

  const empMiss = model.unresolved.includes('emp');
  const projMiss = model.unresolved.includes('proj');
  const projName = model.proj_name ?? (model.fix != null ? t('report.repairLabel', { n: model.fix }) : '');
  const status = props.statusOf(model.emp_num);

  // Exactly one of project / ticket (client feedback #3, #5 — confirms WP §4.5):
  // filling either locks the other, and keyboard traversal skips the locked cell.
  // A legacy row that somehow has both stays fully editable so it can be fixed.
  const projFilled = model.projText.trim() !== '';
  const fixFilled = model.fixText.trim() !== '';
  const projDisabled = fixFilled && !projFilled;
  const fixDisabled = projFilled && !fixFilled;

  return (
    <tr className={isDraft ? 'draft' : ''}>
      {/* Date */}
      <td>
        <input
          data-grid-input
          type="date"
          dir="ltr"
          value={model.date}
          onChange={(e) => update({ date: e.target.value })}
          onBlur={saveIfExisting}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget.closest('tr')?.querySelectorAll<HTMLElement>('[data-grid-input]')[1])?.focus();
            }
          }}
        />
      </td>

      {/* Employee (autocomplete) */}
      <AutocompleteCell<Employee>
        value={model.empText}
        adornment={status ? <span className={`dot ${status}`} /> : null}
        search={empSuggest}
        onType={(text) => update({ empText: text, emp_num: null, emp_name: '' })}
        onPick={(e) => update({ empText: e.nick, emp_num: e.num, emp_name: e.name, unresolved: model.unresolved.filter((u) => u !== 'emp') })}
        onEnterEnd={onEnterEnd}
        onBlur={() => {
          reconcile();
          saveIfExisting();
        }}
        ariaLabel={t('aria.employee')}
      />

      {/* Project (autocomplete) — locked while a ticket is chosen */}
      <AutocompleteCell<Project>
        value={model.projText}
        disabled={projDisabled}
        search={projSuggest}
        onType={(text) => update({ projText: text, proj_num: null, proj_name: null })}
        onPick={(p) =>
          update({
            projText: p.nick,
            proj_num: p.num,
            proj_name: p.name,
            unresolved: model.unresolved.filter((u) => u !== 'proj'),
          })
        }
        onEnterEnd={onEnterEnd}
        onBlur={() => {
          reconcile();
          saveIfExisting();
        }}
        ariaLabel={t('aria.project')}
      />

      {/* Repair ticket (autocomplete) — right next to Project (feedback #2),
          locked while a project is chosen */}
      <AutocompleteCell<Repair>
        value={model.fixText}
        disabled={fixDisabled}
        search={fixSuggest}
        onType={(text) =>
          update({
            fixText: text,
            fix: null,
            proj_name: model.proj_num != null ? model.proj_name : null,
          })
        }
        onPick={(r) =>
          update({
            fixText: String(r.fix),
            fix: r.fix,
            proj_name: repairName(r.fix, r.client),
            unresolved: model.unresolved.filter((u) => u !== 'fix'),
          })
        }
        onEnterEnd={onEnterEnd}
        onBlur={() => {
          reconcile();
          saveIfExisting();
        }}
        ariaLabel={t('aria.repairNo')}
      />

      {/* Hours */}
      <td className="num">
        <input
          data-grid-input
          type="number"
          step={0.5}
          min={0}
          value={model.hours}
          onChange={(e) => update({ hours: e.target.value })}
          onBlur={saveIfExisting}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const inputs = [...(e.currentTarget.closest('tr')?.querySelectorAll<HTMLElement>('[data-grid-input]:not([disabled])') ?? [])];
              const i = inputs.indexOf(e.currentTarget);
              const next = inputs[i + 1];
              if (next) next.focus();
              else onEnterEnd();
            }
          }}
        />
      </td>

      {/* Department (autocomplete) */}
      <AutocompleteCell<Department & { bucket_label: string | null }>
        value={model.deptText}
        search={deptSuggest}
        onType={(text) => update({ deptText: text, dept_num: null })}
        onPick={(d) => update({ deptText: d.name, dept_num: d.num })}
        onEnterEnd={onEnterEnd}
        onBlur={() => {
          reconcile();
          saveIfExisting();
        }}
        ariaLabel={t('aria.department')}
      />

      {/* Derived */}
      <td className={`derived ${projMiss ? 'miss' : ''}`}>
        {model.proj_num ?? (projMiss ? t('report.notIdentified') : '')}
      </td>
      <td className="derived" title={projName}>
        {projName.length > 28 ? `${projName.slice(0, 28)}…` : projName}
      </td>
      <td className={`derived ${empMiss ? 'miss' : ''}`}>
        {model.emp_num ?? (empMiss ? t('report.notIdentified') : '')}
      </td>
      <td className="derived">{model.dept_num ?? ''}</td>
      <td className="derived">{model.emp_name}</td>

      {/* Action */}
      <td className="actcell">
        {!isDraft && (
          <button
            className="delx"
            title={t('common.delete')}
            onClick={() => (props as Extract<RowProps, { mode: 'existing' }>).onDelete(props.seed.id)}
          >
            🗑
          </button>
        )}
      </td>
    </tr>
  );
}
