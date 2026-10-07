import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { HoursSummary } from '../components/HoursSummary.tsx';
import { useToast } from '../components/Toast.tsx';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

/**
 * WP §6, §7.3 — the Excel-style hours-entry grid, the system's most-used screen
 * and the highest-risk thing to port. It reproduces the prototype's ergonomics
 * (`renderGrid`/`setupAC`/`finalizeDraft`/`saveExisting`, :367-535): a permanent
 * draft row at the bottom, autocomplete cells, keyboard traversal, live derived
 * columns, and the over-target confirmation.
 *
 * Client feedback round 3 (2026-09-30): a day's rows are listed in ENTRY order
 * (a new row stays at the bottom, #1); the green/yellow/red status dots are gone
 * until the attendance clock drives them (#2); "+" on a row's employee / project
 * cell copies it into the new row (#5); and "Hours summary" opens the per-
 * employee day totals against the standard hours (#6).
 *
 * Client feedback round 4 (2026-10-06): rows have no date cell of their own —
 * every row of the day view is on the date chosen at the top (#4; the all-dates
 * view still shows each row's date, read-only) — and the day's list stays
 * anchored to its bottom row on load, after a new row and on returning from
 * another tab (#5).
 *
 * Client feedback 2026-10-07: a checkbox per row (+ select-all in the header)
 * and "Duplicate selected (n)" above the table. Each selected row is copied —
 * date, project/ticket, hours, department — WITHOUT the employee, as a new
 * editable row; the selection clears. A copy is saved the moment its employee
 * is identified — picked from the list, or a typed name the server confirms
 * (the database requires one) — and the originals never change.
 *
 * What changes for a multi-user server: resolution and the over-target rule are
 * the server's job, not the browser's. A create/update sends what the user typed;
 * the server resolves it and is the only thing that decides "over target". The
 * grid shows an optimistic derived preview from the autocomplete pick, then lets
 * the authoritative row from the response (via query invalidation) replace it.
 */

/** Which cell's "+" was clicked: copy employee+department, or project/ticket+department. */
type DuplicateKind = 'emp' | 'proj';

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

/**
 * The chosen day survives a trip to another tab (the screen unmounts) — with
 * the date now set only at the top, landing back on today would silently move
 * the user's next rows to the wrong day. Kept for the browser session, and only
 * on the day it was chosen: a tab left open overnight starts the morning on today.
 */
const DATE_KEY = 'izy.report.date';

function rememberedDate(): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DATE_KEY) ?? 'null') as { on?: string; date?: string } | null;
    if (saved?.on === todayISO() && saved.date && /^\d{4}-\d{2}-\d{2}$/.test(saved.date)) return saved.date;
  } catch {
    /* storage blocked or garbled — fall back to today */
  }
  return todayISO();
}

function rememberDate(date: string) {
  try {
    sessionStorage.setItem(DATE_KEY, JSON.stringify({ on: todayISO(), date }));
  } catch {
    /* not worth failing entry over */
  }
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
    // Old history rows (pre-2020) were imported without a department; a NULL
    // here used to crash the whole grid on any such day (toInput trims it).
    deptText: r.dept ?? '',
    dept_num: r.dept_num,
    fixText: r.fix == null ? '' : String(r.fix),
    fix: r.fix,
    unresolved: [],
  };
}

/** A duplicated row waiting for its employee (client feedback 2026-10-07). */
interface CopyModel extends GridModel {
  key: number;
  /** Set once its create landed. The copy stays on screen (locked) until the
   *  refetched list carries the saved row, so the row never blinks out and in. */
  savedId: number | null;
}

/** Unsaved copies outlive a trip to another tab (the screen unmounts) — losing
 *  a batch of duplicated rows to a tab click would be maddening. */
let copyStore: CopyModel[] = [];
let nextCopyKey = 1;

/** Everything of the source row except the employee, which the user fills in. */
function copyOf(r: ReportRow): CopyModel {
  return {
    ...fromRow(r),
    id: null,
    empText: '',
    emp_num: null,
    emp_name: '',
    key: nextCopyKey++,
    savedId: null,
  };
}

/** What the user typed in a row's four text cells — identifies which text a
 *  resolve answer belongs to. */
const typedKey = (m: GridModel) =>
  [m.empText, m.projText, m.deptText, m.fixText].map((s) => s.trim()).join('\u0001');

/** A copy can be saved once it has everything the server requires — which
 *  includes a department: a copy of an old history row without one waits for
 *  it rather than failing with a generic "invalid input". */
const copyMissing = (m: GridModel): StringKey | null =>
  !m.empText.trim()
    ? 'report.copy.needEmployee'
    : !(m.projText.trim() || m.fixText.trim()) || !m.hours.trim()
      ? 'report.required'
      : !m.deptText.trim()
        ? 'report.copy.needDept'
        : null;

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
  const [date, setDate] = useState(rememberedDate);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => rememberDate(date), [date]);

  const reports = useReports(
    showAll
      ? { limit: 1000, sort: 'date', dir: 'desc' }
      : // Entry order, oldest first: a newly added row stays at the bottom
        // instead of jumping into alphabetical place (client feedback round 3 #1).
        { date, limit: 1000, sort: 'id', dir: 'asc' }
  );
  const employees = useEmployees(true);
  const submitted = useSubmittedDays({ from: date, to: date });
  const mut = useReportMutations();

  // The new-entry row has no date cell (client feedback round 4 #4): it is
  // always on the date chosen at the top, including a row typed before the
  // date was changed. commitDraft also reads the date through a ref, so a commit
  // racing a date change cannot land on the previous day.
  const [draft, setDraft] = useState<GridModel>(() => emptyDraft(date));
  useEffect(() => {
    setDraft((d) => (d.date === date ? d : { ...d, date }));
  }, [date]);
  const dateRef = useRef(date);
  dateRef.current = date;

  // commitDraft can be invoked from a stale closure (a suggestion pick defers the
  // commit past its own state update), so it must read the draft through a ref —
  // committing the pre-pick draft is what made a ticket-only row look like it
  // "required a project" (client feedback #5, #7).
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // The draft is only cleared in the create's onDone, which runs *after* the
  // awaited round-trip. A second Enter (or a click-then-Enter) in that window
  // used to fire a second identical POST and persist a duplicate row (client
  // feedback round 2 #1). This latch blocks re-entry until the write settles.
  const committing = useRef(false);

  const [confirm, setConfirm] = useState<
    { message: string; onConfirm: () => void; onCancel?: (() => void) | undefined } | null
  >(null);

  const [summaryOpen, setSummaryOpen] = useState(false);

  const rows = reports.data?.data ?? [];
  const qc = useQueryClient();

  /* ---- select rows → duplicate without the employee (client feedback 2026-10-07) */

  // A selection belongs to the list it was made on — changing the day or the
  // view starts clean rather than duplicating rows the user can no longer see.
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  useEffect(() => setSelected(new Set()), [date, showAll]);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const selAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selAllRef.current) selAllRef.current.indeterminate = selectedRows.length > 0 && !allSelected;
  });
  const toggleRow = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const [copies, setCopies] = useState<CopyModel[]>(() => copyStore);
  useEffect(() => {
    copyStore = copies;
  }, [copies]);
  const copiesRef = useRef(copies);
  copiesRef.current = copies;
  // A copy keeps its source row's date; the day view lists the copies of its day.
  const shownCopies = showAll ? copies : copies.filter((c) => c.date === date);
  const waitingCopies = shownCopies.filter((c) => c.savedId == null);

  const focusCopy = (key: number) => {
    const input = document.querySelector<HTMLInputElement>(`tr[data-copy="${key}"] [data-grid-input]`);
    input?.scrollIntoView({ block: 'nearest' });
    input?.focus();
  };

  const duplicateSelected = () => {
    if (selectedRows.length === 0) {
      toast.show(t('report.dupNone'), 'error');
      return;
    }
    // In the list's own order, so the copies read like the rows they came from.
    const made = selectedRows.map(copyOf);
    setCopies((cs) => [...cs, ...made]);
    setSelected(new Set());
    toast.show(t('report.dupDone', { n: made.length }));
    setTimeout(() => focusCopy(made[0]!.key), 30);
  };

  const discardCopy = (key: number) => setCopies((cs) => cs.filter((c) => c.key !== key || c.savedId != null));
  const discardShownCopies = () => {
    const shown = new Set(waitingCopies.map((c) => c.key));
    setCopies((cs) => cs.filter((c) => !shown.has(c.key)));
  };

  // Copies being saved — or already saved. A key leaves only when its save did
  // NOT persist (error / declined over-target), so it can be retried. On
  // success it stays: the "saved" mark reaches copiesRef only on the next
  // render, and a late resolve answer landing in between would otherwise send
  // the same copy a second time (seen in the regression run: two identical rows).
  const copyInFlight = useRef(new Set<number>());
  // The payload each copy last failed with: an automatic (on-blur) save does not
  // re-send — and re-toast — the same rejected row until something in it changes.
  const copyTried = useRef(new Map<number, string>());

  /**
   * Saves a copy as a new row. `explicit` = Enter at the end of the row (always
   * tries, and says what is missing); otherwise it is the automatic save when a
   * cell is left (or a typed name resolves), which only fires once the employee
   * is identified and the row is complete — for a fresh copy, the moment its
   * employee is picked. The date is the copy's own (the source row's), not
   * whatever the top date has become since.
   */
  const commitCopy = (key: number, explicit: boolean, patch?: Partial<GridModel>) => {
    const found = copiesRef.current.find((x) => x.key === key);
    if (!found || found.savedId != null || copyInFlight.current.has(key)) return;
    // `patch` = a resolve answer that has not rendered yet (see reconcile).
    const c = patch ? { ...found, ...patch } : found;
    // Saved automatically only once the employee is IDENTIFIED — picked from
    // the list, or a typed name the server confirmed — never on text still
    // being typed (a cell's blur handler runs 150 ms late). Enter at the end of
    // the row still sends what is typed and lets the server resolve it.
    if (!explicit && c.emp_num == null) return;
    const missing = copyMissing(c);
    if (missing) {
      if (explicit) toast.show(t(missing), 'error');
      return;
    }
    const input = toInput(c);
    const sig = JSON.stringify(input);
    if (!explicit && copyTried.current.get(key) === sig) return;
    copyTried.current.set(key, sig);
    copyInFlight.current.add(key);
    let created: ReportRow | undefined;
    void writeWithOverTarget(
      async (ack) => {
        created = await mut.create.mutateAsync({ ...input, acknowledgeOverTarget: ack });
      },
      () => {
        // copyInFlight keeps the key — this copy is done (see above).
        copyTried.current.delete(key);
        toast.show(t('common.added'));
        // If the user is working in this copy, carry them to the next copy that
        // still needs an employee — filling a batch is then type, Enter, type…
        const row = document.querySelector(`tr[data-copy="${key}"]`);
        const active = document.activeElement;
        const working = !active || active === document.body || (row != null && row.contains(active));
        const next = copiesRef.current.find(
          (x) => x.key !== key && x.savedId == null && !x.empText.trim() && (showAll || x.date === dateRef.current)
        );
        setCopies((cs) => cs.map((x) => (x.key === key ? { ...x, savedId: created?.id ?? -1 } : x)));
        if (working && next) setTimeout(() => focusCopy(next.key), 20);
        void qc
          .refetchQueries({ queryKey: ['reports'], type: 'active' })
          .catch(() => undefined)
          .finally(() => setCopies((cs) => cs.filter((x) => x.key !== key)));
      },
      () => {
        copyInFlight.current.delete(key);
      }
    );
  };

  const setCopyModel =
    (key: number): React.Dispatch<React.SetStateAction<GridModel>> =>
    (action) =>
      setCopies((cs) =>
        cs.map((c) =>
          c.key === key ? { ...c, ...(typeof action === 'function' ? action(c) : action), key, savedId: c.savedId } : c
        )
      );

  // The status dots (complete/partial/not reported vs the target) were removed:
  // the client wants those colours driven by the attendance clock, which is not
  // active yet (client feedback round 3 #2). The day's total stays as a plain count.
  const dayHours = useMemo(() => rows.reduce((s, r) => s + Number(r.hours), 0), [rows]);

  /**
   * Bottom anchoring (client feedback round 4 #5). The day's rows are in entry
   * order with the new-entry row last, so the bottom is where work happens. The
   * list scrolls there:
   *  - when a day's rows first arrive — screen load, a date change, and the
   *    return from another tab (the screen remounts; the rows come from cache);
   *  - when the list grows — a row was added. The refetch lands after the
   *    create's own callback, so the row count is the signal, not the callback.
   * Not after an edit or a delete (the count does not grow), and not while the
   * cursor is in an older row: a colleague's row arriving by refetch must not
   * scroll the row being edited out of view. The all-dates view is newest-first,
   * so switching to it starts at the TOP (it would otherwise inherit the day
   * view's bottom offset and open mid-list).
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ view: string | null; count: number }>({ view: null, count: 0 });
  const view = showAll ? null : date;
  const settled = reports.data != null && !reports.isPlaceholderData;
  useLayoutEffect(() => {
    if (view == null) {
      if (anchor.current.view !== null && scrollRef.current) scrollRef.current.scrollTop = 0;
      anchor.current = { view: null, count: 0 };
      return;
    }
    if (!settled) return; // still showing the previous day's rows
    const first = anchor.current.view !== view;
    const grew = !first && rows.length > anchor.current.count;
    anchor.current = { view, count: rows.length };
    const el = scrollRef.current;
    if (!el || !(first || grew)) return;
    const active = document.activeElement;
    if (grew && active && el.contains(active) && !active.closest('tr.draft, tr.copy')) return;
    el.scrollTop = el.scrollHeight;
  }, [view, settled, rows.length]);

  /**
   * "+" on a row (client feedback round 3 #5): copy that row's employee +
   * department — or project/ticket + department — into the new-entry row, so a
   * run of rows for one employee (or one project) needs only the rest typed.
   * Only the copied fields are overwritten; anything already typed in the new
   * row is kept. Focus lands on the first empty cell.
   */
  const duplicate = (kind: DuplicateKind, m: GridModel) => {
    setDraft((d) => ({
      ...d,
      deptText: m.deptText,
      dept_num: m.dept_num,
      unresolved: [],
      ...(kind === 'emp'
        ? { empText: m.empText, emp_num: m.emp_num, emp_name: m.emp_name }
        : // Both halves of the exactly-one pair are copied, so a ticket row
          // never lands next to a project already typed in the draft.
          { projText: m.projText, proj_num: m.proj_num, proj_name: m.proj_name, fixText: m.fixText, fix: m.fix }),
    }));
    setTimeout(() => {
      const inputs = [
        ...document.querySelectorAll<HTMLInputElement>('tr.draft [data-grid-input]:not([disabled])'),
      ];
      const target = inputs.find((el) => el.value.trim() === '') ?? inputs[0];
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus();
    }, 30);
  };

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
        // Built from the details in the UI's language — the server's sentence
        // used to be hardcoded English (client feedback round 3 #7).
        const d = err.details as unknown as
          | { nick?: string; date?: string; newTotal?: number; target?: number }
          | undefined;
        setConfirm({
          message:
            d?.nick != null && d.newTotal != null && d.target != null
              ? t('report.overTarget', {
                  nick: d.nick,
                  date: d.date ?? '',
                  total: Number(d.newTotal),
                  target: Number(d.target),
                })
              : err.message,
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
    if (committing.current) return; // a create is already in flight — do not double-submit
    const d = { ...draftRef.current, date: dateRef.current };
    // A half-edited date input (now the one at the top) yields '' — sent as-is
    // the server answers a bare "invalid input" and the user is stuck (client
    // feedback #7). Catch it here with a message that names the problem.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      toast.show(t('report.badDate'), 'error');
      return;
    }
    const complete = d.empText.trim() && (d.projText.trim() || d.fixText.trim()) && d.hours.trim();
    if (!complete) {
      toast.show(t('report.required'), 'error');
      return;
    }
    committing.current = true;
    void writeWithOverTarget(
      (ack) => mut.create.mutateAsync({ ...toInput(d), acknowledgeOverTarget: ack }),
      () => {
        committing.current = false;
        toast.show(t('common.added'));
        setDraft(emptyDraft(d.date));
        // Return focus to the top of the fresh draft row.
        setTimeout(() => {
          document
            .querySelector<HTMLInputElement>('tr.draft [data-grid-input]')
            ?.focus();
        }, 20);
      },
      // Released on any non-persisting outcome (error, or a declined over-target
      // prompt) so the user can correct and retry.
      () => {
        committing.current = false;
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
          <button
            className="btn sm"
            onClick={duplicateSelected}
            disabled={selectedRows.length === 0}
            title={selectedRows.length === 0 ? t('report.dupNone') : undefined}
          >
            {t('report.dupSelected', { n: selectedRows.length })}
          </button>
          <div style={{ flex: 1 }} />
          {!showAll && (
            <button className="btn sm ghost" onClick={() => setSummaryOpen(true)}>
              {t('report.summary.button')}
            </button>
          )}
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
              {t('report.dayTotals', { n: rows.length, h: Math.round(dayHours * 100) / 100 })}
              {isSubmitted && <span className="badge-new" style={{ marginInlineStart: 8 }}>{t('report.submitted')}</span>}
            </>
          )}
          {waitingCopies.length > 0 && (
            <span style={{ marginInlineStart: 12, color: '#1a56db' }}>
              ⧉ {t('report.copy.pending', { n: waitingCopies.length })} ·{' '}
              <button type="button" className="linkish" onClick={discardShownCopies}>
                {t('report.copy.discardAll')}
              </button>
            </span>
          )}
        </div>

        {reports.error ? (
          <div className="empty" style={{ color: '#c33' }}>
            {reports.error instanceof Error ? reports.error.message : t('common.failedToLoad')}
          </div>
        ) : (
          <div className="xl-scroll" ref={scrollRef}>
            <table className="xl">
              <thead>
                <tr>
                  {/* Selection — first in the DOM, so the far right under RTL */}
                  <th className="selcell">
                    <input
                      ref={selAllRef}
                      type="checkbox"
                      checked={allSelected}
                      disabled={rows.length === 0}
                      onChange={toggleAll}
                      aria-label={t('report.sel.all')}
                      title={t('report.sel.all')}
                    />
                  </th>
                  {/* Rows carry no date in the day view — the date at the top
                      is theirs (round 4 #4). The all-dates view mixes days, so
                      there each row's date is shown, read-only. */}
                  {showAll && <th style={{ minWidth: 100 }}>{t('report.th.date')}</th>}
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
                    showDate={showAll}
                    selected={selected.has(r.id)}
                    onToggleSelect={toggleRow}
                    onDuplicate={showAll ? undefined : duplicate}
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

                {/* Duplicated rows, waiting for an employee — between the saved
                    rows and the new-entry row, where a saved copy then sits. */}
                {shownCopies.map((c) => (
                  <RowEditor
                    key={`copy-${c.key}`}
                    mode="draft"
                    draft={c}
                    setDraft={setCopyModel(c.key)}
                    onCommit={() => commitCopy(c.key, true)}
                    copy={{
                      key: c.key,
                      showDate: showAll,
                      locked: c.savedId != null,
                      onAutoCommit: (patch) => commitCopy(c.key, false, patch),
                      onDiscard: () => discardCopy(c.key),
                    }}
                  />
                ))}

                {!showAll && (
                  <RowEditor
                    mode="draft"
                    draft={draft}
                    setDraft={setDraft}
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

      {summaryOpen && (
        <HoursSummary
          date={date}
          rows={rows}
          employees={employees.data ?? []}
          loading={reports.isLoading || employees.isLoading}
          onClose={() => setSummaryOpen(false)}
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
      /** All-dates view only: the row's own date, read-only. */
      showDate: boolean;
      /** The row's selection checkbox (client feedback 2026-10-07). */
      selected: boolean;
      onToggleSelect: (id: number) => void;
      /** Absent in the all-dates view, which has no new-entry row to copy into. */
      onDuplicate?: ((kind: DuplicateKind, m: GridModel) => void) | undefined;
      onSave: (m: GridModel, onError: () => void) => void;
      onDelete: (id: number) => void;
    }
  | {
      mode: 'draft';
      draft: GridModel;
      setDraft: React.Dispatch<React.SetStateAction<GridModel>>;
      onCommit: () => void;
      /** Set for a duplicated row: an unsaved row like the new-entry one, that
       *  saves itself once complete (on leaving a cell) and can be discarded. */
      copy?:
        | {
            key: number;
            showDate: boolean;
            /** Saved, waiting for the refetched list to take its place. */
            locked: boolean;
            /** `patch`: a resolve answer not rendered yet. */
            onAutoCommit: (patch?: Partial<GridModel>) => void;
            onDiscard: () => void;
          }
        | undefined;
    };

/** The small "+" inside a cell. mousedown is swallowed so the click never
 *  steals focus from (or blurs into) the grid's inputs mid-edit. */
function DupButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="dup-btn"
      title={title}
      aria-label={title}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      +
    </button>
  );
}

function RowEditor(props: RowProps) {
  const t = useT();
  const isDraft = props.mode === 'draft';

  /** A ticket's display name, shaped like the server's display_proj_name: the
   *  number, then the client, then the ticket's own date — so the grid shows the
   *  same "17033 · באסם דאבח · 2026-07-12" the dropdown does, not just the number
   *  (client feedback round 2 #4). */
  const repairName = (n: number, client: string | null | undefined, date?: string | null) =>
    t('report.repairLabel', { n }) +
    (client ? ` · ${client}` : '') +
    (date ? ` · ${date}` : '');

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

  const copy = props.mode === 'draft' ? props.copy : undefined;

  /** Reconcile the derived columns for whatever the user typed but did not pick
   *  (e.g. Tab-out of an exact nickname). Uses the same server resolver the save
   *  will use, so the preview cannot disagree with what gets stored. */
  const reconcile = () => {
    const m = modelRef.current;
    if (!m.empText.trim() && !m.projText.trim() && !m.deptText.trim() && !m.fixText.trim()) return;
    // The answer is for the text as it is NOW. A blur's handler runs 150 ms
    // late and the request takes a round trip, so the user may have typed on by
    // the time it lands — an answer for older text must not attach, say, the
    // employee of a half-typed name to the row. Stale answers are dropped.
    const asked = typedKey(m);
    void api.lookup
      .resolve({
        emp: m.empText.trim() || (m.emp_num != null ? String(m.emp_num) : null),
        proj: m.projText.trim() || (m.proj_num != null ? String(m.proj_num) : null),
        dept: m.deptText.trim() || null,
        fix: m.fixText.trim() || (m.fix != null ? String(m.fix) : null),
      })
      .then((res) => {
        if (typedKey(modelRef.current) !== asked) return;
        const patch: Partial<GridModel> = {
          emp_num: res.employee?.emp_num ?? null,
          emp_name: res.employee?.emp_name ?? '',
          proj_num: res.project?.proj_num ?? null,
          proj_name:
            res.project?.proj_name ??
            (res.repair ? repairName(res.repair.fix, res.repair.client, res.repair.date) : null),
          dept_num: res.department?.dept_num ?? null,
          fix: res.repair?.fix ?? null,
          unresolved: res.unresolved,
        };
        update(patch);
        // A copy whose employee was typed in full rather than picked is saved
        // once the server has identified that employee.
        copy?.onAutoCommit(patch);
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

  const locked = copy?.locked ?? false;
  /** Leaving any cell: an existing row saves its edit, a copy saves once complete. */
  const leaveCell = () => {
    reconcile();
    saveIfExisting();
    copy?.onAutoCommit();
  };

  const empMiss = model.unresolved.includes('emp');
  const projMiss = model.unresolved.includes('proj');
  const projName = model.proj_name ?? (model.fix != null ? t('report.repairLabel', { n: model.fix }) : '');

  const onDuplicate = props.mode === 'existing' ? props.onDuplicate : undefined;
  const dupEmp =
    onDuplicate && model.empText.trim() ? (
      <DupButton title={t('report.dup.emp')} onClick={() => onDuplicate('emp', modelRef.current)} />
    ) : null;
  const dupProj = onDuplicate ? (
    <DupButton title={t('report.dup.proj')} onClick={() => onDuplicate('proj', modelRef.current)} />
  ) : null;

  // Exactly one of project / ticket (client feedback #3, #5 — confirms WP §4.5):
  // filling either locks the other, and keyboard traversal skips the locked cell.
  // A legacy row that somehow has both stays fully editable so it can be fixed.
  const projFilled = model.projText.trim() !== '';
  const fixFilled = model.fixText.trim() !== '';
  const projDisabled = locked || (fixFilled && !projFilled);
  const fixDisabled = locked || (projFilled && !fixFilled);

  const rowClass = copy ? 'copy' : isDraft ? 'draft' : props.selected ? 'sel' : '';

  return (
    <tr className={rowClass} data-copy={copy?.key}>
      {/* Selection checkbox — not a grid input, so Enter/Tab traversal skips it */}
      <td className="selcell">
        {props.mode === 'existing' ? (
          <input
            type="checkbox"
            checked={props.selected}
            onChange={() => props.onToggleSelect(props.seed.id)}
            aria-label={t('report.sel.row')}
          />
        ) : copy ? (
          <span className="copy-mark" title={t('report.copy.tag')}>
            ⧉
          </span>
        ) : null}
      </td>

      {/* Date — no cell in the day view (round 4 #4); read-only in all-dates */}
      {((props.mode === 'existing' && props.showDate) || copy?.showDate) && (
        <td className="derived" dir="ltr">
          {model.date}
        </td>
      )}

      {/* Employee (autocomplete) */}
      <AutocompleteCell<Employee>
        value={model.empText}
        disabled={locked}
        adornment={dupEmp}
        search={empSuggest}
        {...(copy ? { placeholder: t('report.copy.pickEmployee') } : {})}
        onType={(text) => update({ empText: text, emp_num: null, emp_name: '' })}
        onPick={(e) => update({ empText: e.nick, emp_num: e.num, emp_name: e.name, unresolved: model.unresolved.filter((u) => u !== 'emp') })}
        onEnterEnd={onEnterEnd}
        onBlur={leaveCell}
        ariaLabel={t('aria.employee')}
      />

      {/* Project (autocomplete) — locked while a ticket is chosen */}
      <AutocompleteCell<Project>
        value={model.projText}
        disabled={projDisabled}
        adornment={projFilled ? dupProj : null}
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
        onBlur={leaveCell}
        ariaLabel={t('aria.project')}
      />

      {/* Repair ticket (autocomplete) — right next to Project (feedback #2),
          locked while a project is chosen */}
      <AutocompleteCell<Repair>
        value={model.fixText}
        disabled={fixDisabled}
        // A ticket row's "+" sits on the ticket: it copies ticket + department.
        adornment={fixFilled && !projFilled ? dupProj : null}
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
            proj_name: repairName(r.fix, r.client, r.date),
            unresolved: model.unresolved.filter((u) => u !== 'fix'),
          })
        }
        onEnterEnd={onEnterEnd}
        onBlur={leaveCell}
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
          disabled={locked}
          onChange={(e) => update({ hours: e.target.value })}
          onBlur={() => {
            saveIfExisting();
            copy?.onAutoCommit();
          }}
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
        disabled={locked}
        {...(copy ? { placeholder: t('report.copy.pickDept') } : {})}
        search={deptSuggest}
        onType={(text) => update({ deptText: text, dept_num: null })}
        onPick={(d) => update({ deptText: d.name, dept_num: d.num })}
        onEnterEnd={onEnterEnd}
        onBlur={leaveCell}
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
        {copy && !locked && (
          <button className="delx" title={t('report.copy.remove')} aria-label={t('report.copy.remove')} onClick={copy.onDiscard}>
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}
