import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ImportChange,
  type ImportPreview,
  type ImportRemoveRequest,
  type RemovableType,
  type Role,
  type WorkbookCommitResult,
  type WorkbookPreview,
  type WorkbookSection,
} from '../api/client.ts';
import { ConfirmDialog } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

/**
 * WP §6.5 / §9 — Excel import, preview-then-commit. Choosing a file uploads it
 * for a PREVIEW (nothing written); confirming posts the very same file again to
 * commit — the server re-parses and re-diffs, so what is applied is exactly what
 * was previewed even if someone else changed data in between (anything now
 * unchanged is simply skipped).
 *
 * ONE upload (Arad, 2026-09-29): the office's hours workbook, דיווח שעות.xlsm,
 * carries the four master lists and the report history ("דיווחי שעות"), and the
 * office re-uploads it as it grows.
 *
 * Client feedback round 3 (2026-09-30) #3 #4 #8 — the preview is a real review
 * step: every record that will be ADDED or UPDATED is listed (with what changes),
 * and records that are in the system but no longer in the file are offered for
 * REMOVAL, each with a checkbox. Nothing is removed unless it is ticked and the
 * summary confirmation is accepted. "Removed" = deactivated / archived / closed
 * on the server, never deleted — past reports keep pointing at them.
 */

const SECTION_TITLE: Record<WorkbookSection, StringKey> = {
  departments: 'import.card.departments',
  employees: 'import.card.employees',
  projects: 'import.card.projects',
  repairs: 'import.card.repairs',
  reports: 'import.card.history',
};

/** What "remove" means per list, shown next to the removal checkboxes. */
const REMOVAL_MEANING: Record<RemovableType, StringKey> = {
  employees: 'import.remove.meaning.employees',
  projects: 'import.remove.meaning.projects',
  repairs: 'import.remove.meaning.repairs',
};

const FIELD_LABEL: Record<string, StringKey> = {
  name: 'import.field.name',
  nick: 'import.field.nick',
  active: 'import.field.active',
  contractor: 'import.field.contractor',
  client: 'import.field.client',
  overhead: 'import.field.overhead',
  archived: 'import.field.archived',
  closed: 'import.field.closed',
  num: 'import.field.num',
};

const ACCEPT = '.xlsx,.xlsm,.xls';

const isRemovable = (t: WorkbookSection): t is RemovableType =>
  t === 'employees' || t === 'projects' || t === 'repairs';

type Selection = Record<RemovableType, Set<number>>;

/**
 * Nothing starts ticked: removal is opt-in, record by record (or "remove all").
 * The first real import (2026-09-30) showed why — the office's copy of the
 * workbook was older than the app's data, and a pre-ticked list removed
 * projects and tickets that were still in use.
 */
function initialSelection(): Selection {
  return { employees: new Set(), projects: new Set(), repairs: new Set() };
}

type State =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'preview'; file: File; preview: WorkbookPreview }
  | { phase: 'committing'; file: File; preview: WorkbookPreview }
  | { phase: 'done'; result: WorkbookCommitResult };

export function ImportScreen({ role }: { role: Role }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const canImport = role === 'manager' || role === 'admin';
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [failure, setFailure] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [confirming, setConfirming] = useState(false);

  const reset = () => {
    setState({ phase: 'idle' });
    setFailure(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setFailure(null);
    setState({ phase: 'reading' });
    try {
      const preview = await api.imports.workbookPreview(file);
      setSelection(initialSelection());
      setState({ phase: 'preview', file, preview });
    } catch (e) {
      reset();
      setFailure(e instanceof Error ? e.message : t('import.failed'));
    }
  };

  const removeRequest = (): ImportRemoveRequest => ({
    employees: [...selection.employees],
    projects: [...selection.projects],
    repairs: [...selection.repairs],
  });
  const removeCount = selection.employees.size + selection.projects.size + selection.repairs.size;

  const commit = async () => {
    if (state.phase !== 'preview') return;
    setConfirming(false);
    setState({ phase: 'committing', file: state.file, preview: state.preview });
    try {
      const result = await api.imports.workbookCommit(state.file, removeRequest());
      setState({ phase: 'done', result });
      if (inputRef.current) inputRef.current.value = '';
      toast.show(t('import.done', { n: result.applied }));
      // An import can change anything the app shows — refresh the lot.
      for (const key of ['employees', 'projects', 'departments', 'standard', 'repairs', 'reports', 'submittedDays', 'activity']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (e) {
      setState({ phase: 'preview', file: state.file, preview: state.preview });
      setFailure(e instanceof Error ? e.message : t('import.failed'));
    }
  };

  const preview = state.phase === 'preview' || state.phase === 'committing' ? state.preview : null;
  const adds = preview ? preview.counts.new : 0;
  const updates = preview ? preview.counts.updated : 0;
  const canCommit = adds + updates + removeCount > 0;

  const toggle = (type: RemovableType, key: number, on: boolean) =>
    setSelection((s) => {
      const next = new Set(s[type]);
      if (on) next.add(key);
      else next.delete(key);
      return { ...s, [type]: next };
    });
  const setAll = (type: RemovableType, keys: number[], on: boolean) =>
    setSelection((s) => ({ ...s, [type]: on ? new Set(keys) : new Set<number>() }));

  return (
    <div className="card">
      {!canImport && (
        <div className="mini" style={{ marginBottom: 10 }}>
          {t('import.roleNote', { role })}
        </div>
      )}

      <div className="imp">
        <span className="ico">📒</span>
        <div>
          <div className="t">{t('import.card.workbook')}</div>
          <div className="d">{t('import.desc.workbook')}</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={!canImport || state.phase === 'reading' || state.phase === 'committing'}
          onChange={(e) => void choose(e.target.files?.[0])}
        />

        <div style={{ flexBasis: '100%' }}>
          {state.phase === 'reading' && <div className="mini">{t('import.readingWorkbook')}</div>}

          {failure && (
            <div className="mini" style={{ color: '#c33' }}>
              {failure}
            </div>
          )}

          {preview && (
            <div className="preview">
              <div className="mini" style={{ marginBottom: 10 }}>
                <b>{t('import.review.intro')}</b>
              </div>

              {preview.sections.map((s) => (
                <SectionReview
                  key={s.type}
                  section={s}
                  creates={s.type === 'reports' ? preview.creates : null}
                  selected={isRemovable(s.type) ? selection[s.type] : null}
                  onToggle={(key, on) => isRemovable(s.type) && toggle(s.type, key, on)}
                  onAll={(on) =>
                    isRemovable(s.type) && setAll(s.type, (s.removals ?? []).map((r) => r.key), on)
                  }
                />
              ))}

              <div className="imp-summary">
                {t('import.review.summary', { add: adds, upd: updates, rem: removeCount })}
              </div>
              <button
                className="btn grn sm"
                onClick={() => setConfirming(true)}
                disabled={state.phase === 'committing' || !canCommit}
              >
                {state.phase === 'committing' ? t('common.working') : t('import.confirm')}
              </button>{' '}
              <button className="btn sm ghost" onClick={reset} disabled={state.phase === 'committing'}>
                {t('common.cancel')}
              </button>
            </div>
          )}

          {state.phase === 'done' && (
            <div className="mini" style={{ color: '#137333' }}>
              {t('import.doneDetail', {
                n: state.result.applied,
                emp: state.result.removed.employees.length,
                proj: state.result.removed.projects.length,
                fix: state.result.removed.repairs.length,
              })}
            </div>
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          message={t('import.review.confirm', { add: adds, upd: updates, rem: removeCount })}
          confirmLabel={t('import.confirm')}
          onConfirm={() => void commit()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {toast.node}
    </div>
  );
}

/* ------------------------------------------------------------ one list */

function SectionReview({
  section,
  creates,
  selected,
  onToggle,
  onAll,
}: {
  section: ImportPreview & { type: WorkbookSection };
  creates: WorkbookPreview['creates'] | null;
  selected: Set<number> | null;
  onToggle: (key: number, on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const t = useT();
  const c = section.counts;
  const added = section.rows.filter((r) => r.status === 'new');
  const updated = section.rows.filter((r) => r.status === 'update');
  const removals = section.removals ?? [];

  return (
    <div className="imp-section">
      <div className="t">{t(SECTION_TITLE[section.type])}</div>
      <span className="tag add">{t('import.tag.new', { n: c.new })}</span>
      <span className="tag upd">{t('import.tag.updated', { n: c.updated })}</span>
      <span className="tag same">{t('import.tag.unchanged', { n: c.unchanged })}</span>
      {removals.length > 0 && <span className="tag rem">{t('import.tag.remove', { n: removals.length })}</span>}
      {c.invalid > 0 && <span className="tag err">{t('import.tag.invalid', { n: c.invalid })}</span>}

      {creates && creates.employees + creates.projects + creates.repairs > 0 && (
        <div className="mini" style={{ margin: '4px 0' }}>
          {t('import.history.creates', { emp: creates.employees, proj: creates.projects, fix: creates.repairs })}
        </div>
      )}

      {added.length > 0 && (
        <details className="imp-list">
          <summary>{t('import.list.added', { n: c.new })}</summary>
          <ul>
            {added.map((r, i) => (
              <li key={i}>{r.label}</li>
            ))}
          </ul>
          {section.rowsTruncated > 0 && <div className="mini">{t('import.moreErrors', { n: section.rowsTruncated })}</div>}
        </details>
      )}

      {updated.length > 0 && (
        <details className="imp-list">
          <summary>{t('import.list.updated', { n: c.updated })}</summary>
          <ul>
            {updated.map((r, i) => (
              <li key={i}>
                {r.label}
                {r.changes && r.changes.length > 0 && (
                  <span className="mini"> — {r.changes.map((ch) => <ChangeText key={ch.field} change={ch} />)}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {removals.length > 0 && selected && isRemovable(section.type) && (
        <details className="imp-list rem" open>
          <summary>{t('import.list.removals', { n: removals.length })}</summary>
          <div className="mini" style={{ margin: '4px 0' }}>
            {t(REMOVAL_MEANING[section.type])}
          </div>
          <label className="mini" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={selected.size === removals.length}
              onChange={(e) => onAll(e.target.checked)}
            />
            {t('import.remove.all', { n: selected.size, total: removals.length })}
          </label>
          <ul>
            {removals.map((r) => (
              <li key={r.key}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={selected.has(r.key)} onChange={(e) => onToggle(r.key, e.target.checked)} />
                  {r.label}
                </label>
                {r.warn?.includes('newer') && <span className="imp-warn">{t('import.remove.warn.newer')}</span>}
                {r.warn?.includes('recent') && (
                  <span className="imp-warn">{t('import.remove.warn.recent', { date: r.lastReport ?? '' })}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {section.errors.length > 0 && (
        <details className="imp-list err">
          <summary>{t('import.list.errors', { n: c.invalid })}</summary>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {section.errors.map((e, i) => (
              <div key={i} className="mini" style={{ color: '#c5221f' }}>
                {e.row > 0 ? t('import.rowN', { n: e.row }) : ''}
                {e.reason}
              </div>
            ))}
            {section.errorsTruncated > 0 && <div className="mini">{t('import.moreErrors', { n: section.errorsTruncated })}</div>}
          </div>
        </details>
      )}
    </div>
  );
}

function ChangeText({ change }: { change: ImportChange }) {
  const t = useT();
  const show = (v: unknown) =>
    v === true ? t('common.yes') : v === false ? t('common.no') : v == null ? '—' : String(v);
  const label = FIELD_LABEL[change.field];
  return (
    <span className="imp-change">
      {label ? t(label) : change.field}: {show(change.from)} → {show(change.to)}
    </span>
  );
}
