import { useState } from 'react';
import { exportUrl, type ActivityListParams, type Role } from '../api/client.ts';
import { useActivity, useClearActivity, useVocabulary } from '../api/hooks.ts';
import { ConfirmDialog } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n/index.tsx';

/**
 * WP §6.7 — the audit trail. Pulled forward from Phase 4 at the client's request
 * (feedback 2026-08-03 #8). The entries themselves have been written since
 * Phase 1: every data-changing route logs in the same transaction as its change,
 * so this screen is read-only over data that already exists.
 *
 * The action/entity columns store stable codes; their display labels come from
 * /api/meta/vocabulary so the log renders in the server's language without the
 * client hardcoding a second translation table. Excel export arrives with the
 * Phase 3 export infrastructure.
 */

const PAGE = 50;

export function LogScreen({ role }: { role: Role }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const canClear = role === 'admin';

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);

  const params: ActivityListParams = {
    limit: PAGE,
    offset,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(action ? { action } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  };
  const log = useActivity(params);
  const vocab = useVocabulary();
  const clear = useClearActivity();

  const rows = log.data?.data ?? [];
  const meta = log.data?.meta;
  const total = meta?.totalRows ?? 0;

  const actionLabel = (code: string) => vocab.data?.actions[code] ?? code;
  const entityLabel = (code: string | null) => (code ? vocab.data?.entities[code] ?? code : '');

  const resetPageAnd = (fn: () => void) => {
    fn();
    setOffset(0);
  };

  const when = (ts: string) =>
    new Date(ts).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  const doClear = () => {
    setConfirmClear(false);
    void clear
      .mutateAsync()
      .then(() => toast.show(t('log.cleared')))
      .catch((e) => toast.show(e instanceof Error ? e.message : t('log.clearFailed'), 'error'));
  };

  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <label>
            {t('archive.from')}{' '}
            <input type="date" value={from} dir="ltr" onChange={(e) => resetPageAnd(() => setFrom(e.target.value))} />
          </label>
          <label>
            {t('archive.to')}{' '}
            <input type="date" value={to} dir="ltr" onChange={(e) => resetPageAnd(() => setTo(e.target.value))} />
          </label>
          <label>
            {t('log.th.action')}{' '}
            <select value={action} onChange={(e) => resetPageAnd(() => setAction(e.target.value))}>
              <option value="">{t('log.filter.allActions')}</option>
              {Object.entries(vocab.data?.actions ?? {}).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 160 }}>
            {t('archive.search')}{' '}
            <input
              type="text"
              value={q}
              placeholder={t('log.searchPlaceholder')}
              style={{ width: '100%' }}
              onChange={(e) => resetPageAnd(() => setQ(e.target.value))}
            />
          </label>
          <a
            className="btn sm ghost"
            href={exportUrl('activity', { from, to, action, q: q.trim() })}
            download
          >
            {t('common.exportExcel')}
          </a>
          {canClear && (
            <button className="btn sm ghost" onClick={() => setConfirmClear(true)} disabled={clear.isPending}>
              {t('log.clear')}
            </button>
          )}
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <div className="kpi">
            <div className="v">{total.toLocaleString()}</div>
            <div className="l">{t('log.kpi.entries')}</div>
          </div>
        </div>

        {log.error ? (
          <div className="empty" style={{ color: '#c33' }}>
            {log.error instanceof Error ? log.error.message : t('common.failedToLoad')}
          </div>
        ) : (
          <>
            <div className="xl-scroll" style={{ maxHeight: '58vh' }}>
              <table className="xl" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 130 }}>{t('log.th.when')}</th>
                    <th style={{ minWidth: 110 }}>{t('log.th.user')}</th>
                    <th style={{ minWidth: 130 }}>{t('log.th.action')}</th>
                    <th style={{ minWidth: 90 }}>{t('log.th.entity')}</th>
                    <th style={{ minWidth: 260 }}>{t('log.th.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="derived">
                        <span dir="ltr">{when(r.ts)}</span>
                      </td>
                      <td className="derived">{r.user_name ?? t('log.system')}</td>
                      <td className="derived">{actionLabel(r.action)}</td>
                      <td className="derived">{entityLabel(r.entity)}</td>
                      <td className="derived" style={{ textAlign: 'start', maxWidth: 420 }} title={r.detail}>
                        {r.detail}
                      </td>
                    </tr>
                  ))}
                  {!log.isLoading && rows.length === 0 && (
                    <tr>
                      <td className="derived" colSpan={5}>
                        <div className="empty">{t('log.empty')}</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="toolbar" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <span className="mini">
                {total === 0
                  ? t('archive.zeroRows')
                  : t('archive.range', {
                      from: offset + 1,
                      to: Math.min(offset + rows.length, total),
                      total: total.toLocaleString(),
                    })}
                {log.isFetching && t('archive.loadingSuffix')}
              </span>
              <button
                className="btn sm ghost"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
              >
                {t('archive.prev')}
              </button>
              <button
                className="btn sm ghost"
                disabled={!meta?.hasMore}
                onClick={() => setOffset((o) => o + PAGE)}
              >
                {t('archive.next')}
              </button>
            </div>
          </>
        )}
      </div>

      {confirmClear && (
        <ConfirmDialog
          message={t('log.clearConfirm')}
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {toast.node}
    </>
  );
}
