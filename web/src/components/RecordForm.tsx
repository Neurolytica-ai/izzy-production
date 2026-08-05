import { useState } from 'react';
import { ApiError } from '../api/client.ts';
import { useT } from '../i18n/index.tsx';

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'bool' | 'select' | 'password';
  options?: { value: string; label: string }[];
  /** Shown under the input — used for the "leave empty for the default" hints. */
  hint?: string;
  required?: boolean;
  /** Business keys cannot change once rows reference them. */
  readOnlyOnEdit?: boolean;
}

type Values = Record<string, string | boolean>;

function initialValues(fields: Field[], record: Record<string, unknown> | null): Values {
  const out: Values = {};
  for (const f of fields) {
    const raw = record?.[f.key];
    out[f.key] =
      f.type === 'bool'
        ? raw === undefined
          ? true
          : Boolean(raw)
        : raw === null || raw === undefined
          ? ''
          : String(raw);
  }
  return out;
}

/**
 * Field-spec driven form, mirroring the prototype's EDIT_DEFS approach so all
 * five master entities share one implementation.
 *
 * Empty text becomes null rather than '' — the schema distinguishes them, and
 * WP §5.1 in particular keys off target_hours being NULL to mean "use the
 * default for this employee type".
 *
 * Server-side field errors are surfaced next to the field they belong to, using
 * the `details` array the API returns for validation failures.
 */
export function RecordForm({
  fields,
  record,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  fields: Field[];
  record: Record<string, unknown> | null;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const t = useT();
  const isEdit = record !== null;
  const [values, setValues] = useState<Values>(() => initialValues(fields, record));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const set = (key: string, v: string | boolean) => setValues((prev) => ({ ...prev, [key]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      if (isEdit && f.readOnlyOnEdit) continue;
      const v = values[f.key];
      if (f.type === 'bool') {
        payload[f.key] = Boolean(v);
      } else {
        const s = String(v ?? '').trim();
        payload[f.key] = s === '' ? null : f.type === 'number' ? Number(s) : s;
      }
    }

    try {
      await onSubmit(payload);
      if (!isEdit) setValues(initialValues(fields, null));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(t('common.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (key: string) =>
    error instanceof ApiError ? error.fieldMessage(key) : undefined;

  return (
    <form onSubmit={submit}>
      {fields.map((f) => {
        const disabled = busy || (isEdit && f.readOnlyOnEdit === true);
        const err = fieldError(f.key);
        return (
          <label key={f.key} style={{ display: 'block', margin: '10px 0' }}>
            <span className="mini">
              {f.label}
              {f.required && !isEdit ? ' *' : ''}
            </span>
            <br />
            {f.type === 'bool' ? (
              <select
                value={values[f.key] ? '1' : '0'}
                onChange={(e) => set(f.key, e.target.value === '1')}
                disabled={disabled}
                style={{ width: '100%' }}
              >
                <option value="1">{t('common.yes')}</option>
                <option value="0">{t('common.no')}</option>
              </select>
            ) : f.type === 'select' ? (
              <select
                value={String(values[f.key] ?? '')}
                onChange={(e) => set(f.key, e.target.value)}
                disabled={disabled}
                style={{ width: '100%' }}
              >
                <option value="">{t('form.selectNone')}</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  f.type === 'number'
                    ? 'number'
                    : f.type === 'date'
                      ? 'date'
                      : f.type === 'password'
                        ? 'password'
                        : 'text'
                }
                autoComplete={f.type === 'password' ? 'new-password' : undefined}
                step={f.type === 'number' ? 'any' : undefined}
                value={String(values[f.key] ?? '')}
                onChange={(e) => set(f.key, e.target.value)}
                disabled={disabled}
                style={{ width: '100%', ...(err ? { borderColor: '#c33' } : {}) }}
              />
            )}
            {err ? (
              <span className="mini" style={{ color: '#c33' }}>
                {err}
              </span>
            ) : f.hint ? (
              <span className="mini">{f.hint}</span>
            ) : null}
          </label>
        );
      })}

      {error && !(error instanceof ApiError && error.details?.length) && (
        <div className="pill r" style={{ display: 'block', padding: '8px 12px', margin: '10px 0' }}>
          {error.message}
        </div>
      )}

      <div className="confirm-btns" style={{ marginTop: 14 }}>
        <button className="btn grn" type="submit" disabled={busy}>
          {busy ? t('common.saving') : submitLabel}
        </button>
        {onCancel && (
          <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
