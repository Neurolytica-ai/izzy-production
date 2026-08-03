import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ImportPreview,
  type ImportType,
  type Role,
} from '../api/client.ts';
import { useToast } from '../components/Toast.tsx';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

/**
 * WP §6.5 / §9 — Excel import, preview-then-commit. The seven cards mirror the
 * prototype's import tab (:186-192) so the office loads the same files the same
 * way. Choosing a file uploads it for a PREVIEW (nothing written); confirming
 * posts the very same file again to commit — the server re-parses and re-diffs,
 * so what is applied is exactly what was previewed even if someone else changed
 * data in between (anything now unchanged is simply skipped).
 */

const CARDS: { type: ImportType; icon: string; titleKey: StringKey; descKey: StringKey }[] = [
  { type: 'employees', icon: '👷', titleKey: 'import.card.employees', descKey: 'import.desc.employees' },
  { type: 'projects', icon: '🏗️', titleKey: 'import.card.projects', descKey: 'import.desc.projects' },
  { type: 'departments', icon: '🔧', titleKey: 'import.card.departments', descKey: 'import.desc.departments' },
  { type: 'standard', icon: '📐', titleKey: 'import.card.standard', descKey: 'import.desc.standard' },
  { type: 'attendance', icon: '⏱️', titleKey: 'import.card.attendance', descKey: 'import.desc.attendance' },
  { type: 'repairs', icon: '🛠️', titleKey: 'import.card.repairs', descKey: 'import.desc.repairs' },
  { type: 'reports', icon: '📋', titleKey: 'import.card.reports', descKey: 'import.desc.reports' },
];

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
      {CARDS.map((c) => (
        <ImportCard key={c.type} {...c} disabled={!canImport} />
      ))}
    </div>
  );
}

type CardState =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'preview'; file: File; preview: ImportPreview }
  | { phase: 'committing'; file: File; preview: ImportPreview }
  | { phase: 'done'; applied: number };

function ImportCard({
  type,
  icon,
  titleKey,
  descKey,
  disabled,
}: {
  type: ImportType;
  icon: string;
  titleKey: StringKey;
  descKey: StringKey;
  disabled: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CardState>({ phase: 'idle' });
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
      const preview = await api.imports.preview(type, file);
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
      const result = await api.imports.commit(type, state.file);
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
        accept=".xlsx,.xls"
        disabled={disabled || state.phase === 'reading' || state.phase === 'committing'}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <div style={{ flexBasis: '100%' }}>
        {state.phase === 'reading' && <div className="mini">{t('import.reading')}</div>}

        {failure && (
          <div className="mini" style={{ color: '#c33' }}>
            {failure}
          </div>
        )}

        {preview && (
          <div className="preview">
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

            <button
              className="btn grn sm"
              onClick={() => void commit()}
              disabled={state.phase === 'committing' || preview.counts.new + preview.counts.updated === 0}
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
