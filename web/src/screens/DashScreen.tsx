import { useState } from 'react';
import type { BudgetRow, DashPeriod } from '../api/client.ts';
import { useDashboard } from '../api/hooks.ts';
import { useT } from '../i18n/index.tsx';

/**
 * WP §6.4 — the management dashboard: KPI cards, the budget-vs-actual table
 * (standard vs reported hours per productive project, WP §5.3), and hours by
 * costing bucket. A port of the prototype's renderDash (:576-606) with the
 * arithmetic moved server-side: every figure on this screen comes from the
 * fn_dashboard_* family, so the numbers cannot drift from the coverage screen
 * or any future report reading the same functions.
 *
 * One deliberate improvement over the prototype (WP §6.4 acceptance): projects
 * with reported hours but NO standard defined are shown under the table as a
 * count instead of being silently dropped.
 */

function todayISO(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function DashScreen() {
  const t = useT();
  const [period, setPeriod] = useState<DashPeriod>('week');
  const [date, setDate] = useState(todayISO);
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [client, setClient] = useState('');

  const dash = useDashboard({
    period,
    ...(period === 'day' ? { date } : {}),
    ...(period === 'month' ? { month } : {}),
    ...(client ? { client } : {}),
  });

  const d = dash.data;
  const kpis = d?.kpis;
  const budget = d?.budget ?? [];
  const withStd = budget.filter((b) => b.state !== 'no_standard');
  const noStd = budget.length - withStd.length;
  const buckets = d?.buckets ?? [];
  const maxBucket = Math.max(1, ...buckets.map((b) => Number(b.hours)));

  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <label>
            {t('dash.period')}{' '}
            <select value={period} onChange={(e) => setPeriod(e.target.value as DashPeriod)}>
              <option value="day">{t('dash.period.day')}</option>
              <option value="week">{t('dash.period.week')}</option>
              <option value="month">{t('dash.period.month')}</option>
              <option value="all">{t('dash.period.all')}</option>
            </select>
          </label>
          {period === 'day' && (
            <input type="date" value={date} dir="ltr" onChange={(e) => setDate(e.target.value)} />
          )}
          {period === 'month' && (
            <input type="month" value={month} dir="ltr" onChange={(e) => setMonth(e.target.value)} />
          )}
          <label>
            {t('dash.client')}{' '}
            <select value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">{t('dash.allClients')}</option>
              {(d?.clients ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {period === 'week' && d?.period.from && (
            <span className="mini" dir="ltr">
              {d.period.from} → {d.period.to}
            </span>
          )}
          {dash.isFetching && <span className="mini">{t('common.loading')}</span>}
        </div>

        {dash.error ? (
          <div className="empty" style={{ color: '#c33' }}>
            {dash.error instanceof Error ? dash.error.message : t('common.failedToLoad')}
          </div>
        ) : (
          <>
            {/* KPI cards (prototype :583-587) */}
            <div className="row" style={{ marginBottom: 14 }}>
              <Kpi value={Number(kpis?.total_hours ?? 0).toLocaleString()} label={t('dash.kpi.totalHours')} />
              <Kpi
                value={`${Math.round(Number(kpis?.productive_pct ?? 0))}% / ${Math.round(Number(kpis?.overhead_pct ?? 0))}%`}
                label={t('dash.kpi.prodOverhead')}
              />
              <Kpi value={kpis?.overruns ?? 0} label={t('dash.kpi.overruns')} accent="#c5221f" />
              <Kpi value={kpis?.savings ?? 0} label={t('dash.kpi.savings')} accent="#137333" />
            </div>

            {/* Budget vs actual (WP §5.3) */}
            <div className="section-title">{t('dash.budgetTitle')}</div>
            <div className="xl-scroll" style={{ maxHeight: '44vh' }}>
              <table className="xl" style={{ minWidth: 720, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 150, textAlign: 'start' }}>{t('dash.th.project')}</th>
                    <th style={{ minWidth: 110, textAlign: 'start' }}>{t('dash.th.client')}</th>
                    <th style={{ minWidth: 70 }}>{t('dash.th.planned')}</th>
                    <th style={{ minWidth: 70 }}>{t('dash.th.actual')}</th>
                    <th style={{ minWidth: 70 }}>{t('dash.th.variance')}</th>
                    <th style={{ minWidth: 140 }}>{t('dash.th.utilization')}</th>
                  </tr>
                </thead>
                <tbody>
                  {withStd.map((b) => (
                    <BudgetRowView key={b.proj_num} row={b} />
                  ))}
                  {!dash.isLoading && withStd.length === 0 && (
                    <tr>
                      <td className="derived" colSpan={6}>
                        <div className="empty">{t('dash.noBudgetRows')}</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {noStd > 0 && (
              <div className="mini" style={{ marginTop: 6 }}>
                {t('dash.noStandardNote', { n: noStd })}
              </div>
            )}

            {/* Hours by bucket (prototype :598-604) */}
            <div className="section-title" style={{ marginTop: 18 }}>
              {t('dash.bucketsTitle')}
            </div>
            {buckets.length === 0 ? (
              <div className="empty">{t('dash.noData')}</div>
            ) : (
              <div style={{ maxWidth: 640 }}>
                {buckets.map((b) => (
                  <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 96, fontSize: 12 }}>{b.label_he}</div>
                    <div className="bar-wrap" style={{ flex: 1 }}>
                      <div
                        className="bar"
                        style={{ width: `${(Number(b.hours) / maxBucket) * 100}%`, background: 'var(--blue2)' }}
                      />
                    </div>
                    <div style={{ width: 52, textAlign: 'end' }}>
                      <b>{Number(b.hours).toLocaleString()}</b>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function BudgetRowView({ row }: { row: BudgetRow }) {
  const variance = Number(row.variance);
  const pct = row.utilization == null ? 0 : Math.round(Number(row.utilization));
  const pillClass = variance > 0 ? 'r' : variance < 0 ? 'g' : 'y';
  // Prototype :592 — red gradient on overrun, green at 100%, blue while under.
  const fill =
    variance > 0
      ? 'linear-gradient(90deg,#ff7a6b,#e8453c)'
      : pct >= 100
        ? 'linear-gradient(90deg,#2fa84f,#1e7e34)'
        : 'linear-gradient(90deg,#5b8def,#2e5496)';

  return (
    <tr>
      <td style={{ textAlign: 'start' }}>
        {row.proj_nick} <span className="mini">({row.proj_num})</span>
      </td>
      <td style={{ textAlign: 'start' }}>{row.client}</td>
      <td className="derived">{row.std_total}</td>
      <td className="derived">{Number(row.actual)}</td>
      <td className="derived">
        <span className={`pill ${pillClass}`}>
          {variance > 0 ? '+' : ''}
          {Number(variance.toFixed(1))}
        </span>
      </td>
      <td>
        <div className="pbar">
          <div className="pbar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: fill }} />
          <span className="pbar-txt">{pct}%</span>
        </div>
      </td>
    </tr>
  );
}

function Kpi({ value, label, accent }: { value: React.ReactNode; label: string; accent?: string }) {
  return (
    <div className="kpi">
      <div className="v" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="l">{label}</div>
    </div>
  );
}
