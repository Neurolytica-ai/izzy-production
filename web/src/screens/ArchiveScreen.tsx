import { useState } from 'react';
import type { ReportListParams, ReportRow, Role } from '../api/client.ts';
import { useReportMutations, useReports } from '../api/hooks.ts';
import { ConfirmDialog } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';

/**
 * WP §6.2, §7.3 — the Reports Archive: browse every stored row across all dates,
 * filtered and sorted *in the database*, not the browser.
 *
 * The prototype loaded the whole table into memory and filtered in JS, which the
 * work plan itself flags as not surviving "tens of thousands of rows" (§6.2). Here
 * the filters, the sort, the page window and the totals-for-the-filtered-set all
 * come from the server, so the screen holds one page at a time regardless of how
 * large the table grows.
 */

type SortKey = NonNullable<ReportListParams['sort']>;

const PAGE = 50;

const COLUMNS: { key: SortKey | null; label: string; align?: 'start' }[] = [
  { key: 'date', label: 'Date' },
  { key: 'emp_nick', label: 'Employee', align: 'start' },
  { key: 'proj_nick', label: 'Project / repair', align: 'start' },
  { key: 'hours', label: 'Hours' },
  { key: 'dept', label: 'Department' },
  { key: 'client', label: 'Customer', align: 'start' },
  { key: null, label: 'Entered by' },
];

export function ArchiveScreen({ role }: { role: Role }) {
  const canDelete = role === 'manager' || role === 'admin';
  const toast = useToast();
  const mut = useReportMutations();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState<ReportRow | null>(null);

  const params: ReportListParams = {
    limit: PAGE,
    offset,
    sort,
    dir,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  };
  const reports = useReports(params);

  const rows = reports.data?.data ?? [];
  const meta = reports.data?.meta;
  const total = meta?.totalRows ?? 0;

  const sortBy = (key: SortKey) => {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
    setOffset(0);
  };

  const resetPageAnd = (fn: () => void) => {
    fn();
    setOffset(0);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    void mut.remove
      .mutateAsync(id)
      .then(() => toast.show('Deleted'))
      .catch((e) => toast.show(e instanceof Error ? e.message : 'Delete failed', 'error'));
  };

  const arrow = (key: SortKey) => (key === sort ? (dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <label>
            From{' '}
            <input type="date" value={from} dir="ltr" onChange={(e) => resetPageAnd(() => setFrom(e.target.value))} />
          </label>
          <label>
            To{' '}
            <input type="date" value={to} dir="ltr" onChange={(e) => resetPageAnd(() => setTo(e.target.value))} />
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>
            Search{' '}
            <input
              type="text"
              value={q}
              placeholder="employee, project, customer, department, repair #"
              style={{ width: '100%' }}
              onChange={(e) => resetPageAnd(() => setQ(e.target.value))}
            />
          </label>
          {(from || to || q) && (
            <button
              className="btn sm ghost"
              onClick={() => resetPageAnd(() => {
                setFrom('');
                setTo('');
                setQ('');
              })}
            >
              Clear
            </button>
          )}
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <Kpi value={total.toLocaleString()} label="Rows (filtered)" />
          <Kpi value={Number(meta?.totalHours ?? 0).toLocaleString()} label="Total hours" />
          <Kpi value={meta?.days ?? 0} label="Distinct days" />
        </div>

        {reports.error ? (
          <div className="empty" style={{ color: '#c33' }}>
            {reports.error instanceof Error ? reports.error.message : 'Failed to load'}
          </div>
        ) : (
          <>
            <div className="xl-scroll" style={{ maxHeight: '58vh' }}>
              <table className="xl" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.label}
                        className={c.key ? 'sortable' : ''}
                        style={c.align ? { textAlign: c.align } : undefined}
                        onClick={c.key ? () => sortBy(c.key!) : undefined}
                      >
                        {c.label}
                        {c.key && <span className="arr">{arrow(c.key)}</span>}
                      </th>
                    ))}
                    {canDelete && <th style={{ width: 34 }} />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="derived">
                        <span dir="ltr">{r.date}</span>
                      </td>
                      <td className="derived" style={{ textAlign: 'start' }}>
                        {r.emp_nick} <span className="mini">{r.emp_name}</span>
                      </td>
                      <td className="derived" style={{ textAlign: 'start' }} title={r.display_proj_name ?? ''}>
                        {r.fix != null ? (
                          <span className="pill y">repair {r.fix}</span>
                        ) : (
                          truncate(r.display_proj_name ?? r.proj_nick ?? '—', 40)
                        )}
                      </td>
                      <td className="derived">
                        <b>{Number(r.hours)}</b>
                      </td>
                      <td className="derived">{r.dept}</td>
                      <td className="derived" style={{ textAlign: 'start' }}>
                        {r.client ?? r.repair_client ?? '—'}
                      </td>
                      <td className="derived">{r.created_by_name ?? '—'}</td>
                      {canDelete && (
                        <td className="actcell">
                          <button className="delx" title="Delete" onClick={() => setDeleting(r)}>
                            🗑
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!reports.isLoading && rows.length === 0 && (
                    <tr>
                      <td className="derived" colSpan={canDelete ? COLUMNS.length + 1 : COLUMNS.length}>
                        <div className="empty">No rows match these filters</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="toolbar" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <span className="mini">
                {total === 0
                  ? '0 rows'
                  : `${offset + 1}–${Math.min(offset + rows.length, total)} of ${total.toLocaleString()}`}
                {reports.isFetching && ' · loading…'}
              </span>
              <button
                className="btn sm ghost"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
              >
                ← Previous
              </button>
              <button
                className="btn sm ghost"
                disabled={!meta?.hasMore}
                onClick={() => setOffset((o) => o + PAGE)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          message={`Delete this row? ${deleting.emp_nick} · ${Number(deleting.hours)}h · ${deleting.date}`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast.node}
    </>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function Kpi({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="kpi">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}
