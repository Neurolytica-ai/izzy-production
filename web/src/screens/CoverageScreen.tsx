import { useState } from 'react';
import type { CoverageRow, Role } from '../api/client.ts';
import { useCoverage, useSetAttendance } from '../api/hooks.ts';
import { useToast } from '../components/Toast.tsx';
import { useT } from '../i18n/index.tsx';

/**
 * WP §6.3 — the attendance cross-check: one row per active employee for a date,
 * comparing reported production hours to the Lumen clock. A faithful port of
 * the prototype's renderCoverage (:540-557): least-covered employees first,
 * status pill per §5.6, clock hours editable inline, |variance| > 1h flagged
 * red (§5.5). All figures come from fn_coverage — the same function the grid's
 * status dots read — so the two screens cannot disagree.
 *
 * Clock edits are a manager action (the server enforces it); for reporters the
 * clock column is read-only.
 */

function todayISO(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function CoverageScreen({ role }: { role: Role }) {
  const t = useT();
  const toast = useToast();
  const canEdit = role === 'manager' || role === 'admin';
  const [date, setDate] = useState(todayISO);

  const coverage = useCoverage(date);
  const setAtt = useSetAttendance();

  const rows = coverage.data ?? [];
  const complete = rows.filter((r) => r.status === 'complete').length;
  const flagged = rows.filter((r) => r.flagged).length;
  const withClock = rows.filter((r) => r.clock != null).length;

  const saveClock = (r: CoverageRow, raw: string) => {
    const trimmed = raw.trim();
    const hours = trimmed === '' ? null : Number(trimmed);
    // No change — an empty input for an employee with no entry, or the same value.
    if (hours === null && r.clock == null) return;
    if (hours !== null && r.clock != null && Number(r.clock) === hours) return;
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 24)) {
      toast.show(t('coverage.badHours'), 'error');
      return;
    }
    setAtt.mutate(
      { date, emp_num: r.emp_num, hours },
      {
        onSuccess: () => toast.show(t('common.saved')),
        onError: (e) => toast.show(e instanceof Error ? e.message : t('common.saveFailed'), 'error'),
      }
    );
  };

  const statusPill = (s: CoverageRow['status']) =>
    s === 'complete' ? (
      <span className="pill g">{t('coverage.status.complete')}</span>
    ) : s === 'partial' ? (
      <span className="pill y">{t('coverage.status.partial')}</span>
    ) : (
      <span className="pill r">{t('coverage.status.notYet')}</span>
    );

  const dotOf = (s: CoverageRow['status']) =>
    s === 'complete' ? 'g' : s === 'partial' ? 'y' : 'r';

  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <label>
            {t('report.th.date')}{' '}
            <input type="date" value={date} dir="ltr" onChange={(e) => setDate(e.target.value)} />
          </label>
          <span className="mini">{t('coverage.hint')}</span>
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <Kpi value={`${complete} / ${rows.length}`} label={t('coverage.kpi.completed')} />
          <Kpi value={withClock} label={t('coverage.kpi.withClock')} />
          <Kpi value={flagged} label={t('coverage.kpi.flagged')} accent={flagged > 0 ? '#c5221f' : undefined} />
        </div>

        {coverage.error ? (
          <div className="empty" style={{ color: '#c33' }}>
            {coverage.error instanceof Error ? coverage.error.message : t('common.failedToLoad')}
          </div>
        ) : (
          <div className="xl-scroll" style={{ maxHeight: '62vh' }}>
            <table className="xl" style={{ minWidth: 720, fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 170, textAlign: 'start' }}>{t('coverage.th.employee')}</th>
                  <th style={{ minWidth: 70 }}>{t('coverage.th.type')}</th>
                  <th style={{ minWidth: 80 }}>{t('coverage.th.status')}</th>
                  <th style={{ minWidth: 70 }}>{t('coverage.th.reported')}</th>
                  <th style={{ minWidth: 60 }}>{t('coverage.th.target')}</th>
                  <th style={{ minWidth: 90 }}>{t('coverage.th.clock')}</th>
                  <th style={{ minWidth: 70 }}>{t('coverage.th.variance')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.emp_num}>
                    <td style={{ textAlign: 'start' }}>
                      <span className={`dot ${dotOf(r.status)}`} /> {r.nick}{' '}
                      <span className="mini">{r.name}</span>
                    </td>
                    <td className="derived">
                      {r.is_contractor ? t('coverage.contractor') : t('master.internal')}
                    </td>
                    <td className="derived">{statusPill(r.status)}</td>
                    <td className="derived">
                      <b>{Number(r.reported)}</b>
                    </td>
                    <td className="derived">{Number(r.target)}</td>
                    <td className="derived">
                      <ClockCell
                        key={`${date}|${r.emp_num}|${r.clock ?? ''}`}
                        initial={r.clock == null ? '' : String(Number(r.clock))}
                        disabled={!canEdit}
                        onCommit={(v) => saveClock(r, v)}
                      />
                    </td>
                    <td className="derived">
                      {r.variance == null ? (
                        '—'
                      ) : (
                        <span className={`pill ${r.flagged ? 'r' : 'g'}`}>
                          {Number(r.variance) > 0 ? '+' : ''}
                          {Number(Number(r.variance).toFixed(1))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!coverage.isLoading && rows.length === 0 && (
                  <tr>
                    <td className="derived" colSpan={7}>
                      <div className="empty">{t('coverage.empty')}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {coverage.isLoading && <div className="empty">{t('common.loading')}</div>}
          </div>
        )}
      </div>

      {toast.node}
    </>
  );
}

/** Uncontrolled clock input: saves on blur or Enter, like the prototype's onchange. */
function ClockCell({
  initial,
  disabled,
  onCommit,
}: {
  initial: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  return (
    <input
      type="number"
      step={0.5}
      min={0}
      max={24}
      defaultValue={initial}
      disabled={disabled}
      style={{ width: 66, textAlign: 'center' }}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function Kpi({ value, label, accent }: { value: React.ReactNode; label: string; accent?: string | undefined }) {
  return (
    <div className="kpi">
      <div className="v" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="l">{label}</div>
    </div>
  );
}
