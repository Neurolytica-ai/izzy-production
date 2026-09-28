import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ImportCounts,
  type ImportPreview,
  type ImportType,
  type Role,
  type WorkbookPreview,
  type WorkbookSection,
} from '../api/client.ts';
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
 * The four master lists (employees, projects, departments, repairs) come from
 * ONE file — the office's hours workbook, דיווח שעות.xlsm (Arad, 2026-09-28) —
 * so they share one card. The remaining cards take their own single-sheet files.
 */

const SINGLE_CARDS: { type: ImportType; icon: string; titleKey: StringKey; descKey: StringKey }[] = [
  { type: 'standard', icon: '📐', titleKey: 'import.card.standard', descKey: 'import.desc.standard' },
  { type: 'attendance', icon: '⏱️', titleKey: 'import.card.attendance', descKey: 'import.desc.attendance' },
  { type: 'reports', icon: '📋', titleKey: 'import.card.reports', descKey: 'import.desc.reports' },
];

const SECTION_TITLE: Record<WorkbookSection, StringKey> = {
  departments: 'import.card.departments',
  employees: 'import.card.employees',
  projects: 'import.card.projects',
  repairs: 'import.card.repairs',
};

const ACCEPT = '.xlsx,.xlsm,.xls';

const hasChanges = (c: ImportCounts) => c.new + c.updated > 0;

export function ImportScreen({ role }: { role: Role }) {
  const t = useT();
  const canImport = role === 'manager' || role === 'admin';

  return (
    <div className="card">
      {!canImport && (
        <div className="mini" style={{ marginBottom: 10 }}>
          {t('import.roleNote', { role })}
        </div>
      )}
      <ImportCard<WorkbookPreview>
        icon="📒"
        titleKey="import.card.workbook"
        descKey="import.desc.workbook"
        readingKey="import.readingWorkbook"
        disabled={!canImport}
        runPreview={api.imports.workbookPreview}
        runCommit={api.imports.workbookCommit}
        countsOf={(p) => p.counts}
        renderPreview={(p) =>
          p.sections.map((s) => (
            <div key={s.type} style={{ marginBottom: 8 }}>
              <div className="t" style={{ fontSize: '0.95em' }}>
                {t(SECTION_TITLE[s.type])}
              </div>
              <PreviewBody preview={s} />
            </div>
          ))
        }
      />
      {SINGLE_CARDS.map((c) => (
        <ImportCard<ImportPreview>
          key={c.type}
          icon={c.icon}
          titleKey={c.titleKey}
          descKey={c.descKey}
          readingKey="import.reading"
          disabled={!canImport}
          runPreview={(file) => api.imports.preview(c.type, file)}
          runCommit={(file) => api.imports.commit(c.type, file)}
          countsOf={(p) => p.counts}
          renderPreview={(p) => <PreviewBody preview={p} />}
        />
      ))}
    </div>
  );
}

/** Count tags, the first changed rows, and the row errors of one list's diff. */
function PreviewBody({ preview }: { preview: ImportPreview }) {
  const t = useT();
  return (
    <>
      <span className="tag add">{t('import.tag.new', { n: preview.counts.new })}</span>
      <span className="tag upd">{t('import.tag.updated', { n: preview.counts.updated })}</span>
      <span className="tag same">{t('import.tag.unchanged', { n: preview.counts.unchanged })}</span>
      {preview.counts.invalid > 0 && (
        <span className="tag err">{t('import.tag.invalid', { n: preview.counts.invalid })}</span>
      )}

      <div style={{ margin: '6px 0' }}>
        {preview.rows
          .filter((r) => r.status !== 'unchanged')
          .slice(0, 6)
          .map((r, i) => (
            <div key={i} className="mini">
              • {r.label}
            </div>
          ))}
      </div>

      {preview.errors.length > 0 && (
        <div style={{ margin: '6px 0', maxHeight: 140, overflowY: 'auto' }}>
          {preview.errors.map((e, i) => (
            <div key={i} className="mini" style={{ color: '#c5221f' }}>
              {e.row > 0 ? t('import.rowN', { n: e.row }) : ''}
              {e.reason}
            </div>
          ))}
          {preview.errorsTruncated > 0 && (
            <div className="mini">{t('import.moreErrors', { n: preview.errorsTruncated })}</div>
          )}
        </div>
      )}
    </>
  );
}

type CardState<P> =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'preview'; file: File; preview: P }
  | { phase: 'committing'; file: File; preview: P }
  | { phase: 'done'; applied: number };

function ImportCard<P>({
  icon,
  titleKey,
  descKey,
  readingKey,
  disabled,
  runPreview,
  runCommit,
  countsOf,
  renderPreview,
}: {
  icon: string;
  titleKey: StringKey;
  descKey: StringKey;
  readingKey: StringKey;
  disabled: boolean;
  runPreview: (file: File) => Promise<P>;
  runCommit: (file: File) => Promise<{ applied: number }>;
  countsOf: (p: P) => ImportCounts;
  renderPreview: (p: P) => ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CardState<P>>({ phase: 'idle' });
  const [failure, setFailure] = useState<string | null>(null);

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
      const preview = await runPreview(file);
      setState({ phase: 'preview', file, preview });
    } catch (e) {
      reset();
      setFailure(e instanceof Error ? e.message : t('import.failed'));
    }
  };

  const commit = async () => {
    if (state.phase !== 'preview') return;
    setState({ phase: 'committing', file: state.file, preview: state.preview });
    try {
      const result = await runCommit(state.file);
      setState({ phase: 'done', applied: result.applied });
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

  return (
    <div className="imp">
      <span className="ico">{icon}</span>
      <div>
        <div className="t">{t(titleKey)}</div>
        <div className="d">{t(descKey)}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        disabled={disabled || state.phase === 'reading' || state.phase === 'committing'}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <div style={{ flexBasis: '100%' }}>
        {state.phase === 'reading' && <div className="mini">{t(readingKey)}</div>}

        {failure && (
          <div className="mini" style={{ color: '#c33' }}>
            {failure}
          </div>
        )}

        {preview && (
          <div className="preview">
            {renderPreview(preview)}
            <button
              className="btn grn sm"
              onClick={() => void commit()}
              disabled={state.phase === 'committing' || !hasChanges(countsOf(preview))}
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
            {t('import.done', { n: state.applied })}
          </div>
        )}
      </div>
      {toast.node}
    </div>
  );
}
