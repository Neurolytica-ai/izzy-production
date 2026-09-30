import { useMemo, useState } from 'react';
import type { Employee, ReportRow } from '../api/client.ts';
import { useT } from '../i18n/index.tsx';
import { Modal } from './Modal.tsx';

/**
 * "Hours summary" for the reporting screen's selected day (client feedback
 * round 3 #6): EVERY active employee — including those with nothing reported,
 * who show 0 — with their reported total against their standard daily hours
 * (employees.effective_target: the Master Data target, else 8.5 / 10.5 for
 * contractors, WP §5.1).
 *
 * Colours mark only the exceptions the client asked for:
 *   red    — reported MORE than the standard hours
 *   yellow — 0 hours, or fewer than the standard (missing hours)
 * A day that matches the standard is left uncoloured.
 *
 * Built from what the grid has already loaded (the day's rows + the active
 * employee list), so it is always in step with the table behind it. An
 * inactive employee who nevertheless has hours that day is included too.
 */

type Status = 'over' | 'missing' | 'under' | 'ok';

interface Line {
  num: number;
  nick: string;
  name: string;
  reported: number;
  target: number;
  status: Status;
}

const EPS = 0.001;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Exceptions first (over, then nothing reported, then short), then by nickname. */
const ORDER: Record<Status, number> = { over: 0, missing: 1, under: 2, ok: 3 };

function statusOf(reported: number, target: number): Status {
  if (reported <= EPS) return 'missing';
  if (reported > target + EPS) return 'over';
  if (reported < target - EPS) return 'under';
  return 'ok';
}

export function HoursSummary({
  date,
  rows,
  employees,
  loading,
  onClose,
}: {
  date: string;
  rows: ReportRow[];
  employees: Employee[];
  loading: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [onlyExceptions, setOnlyExceptions] = useState(false);

  const lines = useMemo(() => {
    const byEmp = new Map<number, Line>();
    for (const e of employees) {
      byEmp.set(e.num, {
        num: e.num,
        nick: e.nick,
        name: e.name,
        reported: 0,
        target: Number(e.effective_target),
        status: 'missing',
      });
    }
    for (const r of rows) {
      let line = byEmp.get(r.emp_num);
      if (!line) {
        line = {
          num: r.emp_num,
          nick: r.emp_nick,
          name: r.emp_name,
          reported: 0,
          target: Number(r.effective_target),
          status: 'missing',
        };
        byEmp.set(r.emp_num, line);
      }
      line.reported += Number(r.hours);
    }
    const out = [...byEmp.values()].map((l) => {
      const reported = round2(l.reported);
      return { ...l, reported, status: statusOf(reported, l.target) };
    });
    out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.nick.localeCompare(b.nick, 'he'));
    return out;
  }, [rows, employees]);

  const totals = useMemo(() => {
    const c = { over: 0, missing: 0, under: 0, ok: 0, reported: 0, target: 0 };
    for (const l of lines) {
      c[l.status]++;
      c.reported += l.reported;
      c.target += l.target;
    }
    return { ...c, reported: round2(c.reported), target: round2(c.target) };
  }, [lines]);

  const shown = onlyExceptions ? lines.filter((l) => l.status !== 'ok') : lines;

  const statusLabel: Record<Status, string> = {
    over: t('report.summary.over'),
    missing: t('report.summary.missing'),
    under: t('report.summary.under'),
    ok: t('report.summary.ok'),
  };

  return (
    <Modal
      title={t('report.summary.title', { date })}
      onClose={onClose}
      width={760}
      footer={
        <button className="btn sm" onClick={onClose}>
          {t('report.summary.close')}
        </button>
      }
    >
      {loading ? (
        <div className="empty">{t('common.loading')}</div>
      ) : (
        <>
          <div className="mini" style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span>{t('report.summary.kpi', { n: lines.length, h: totals.reported, std: totals.target })}</span>
            <span className="sum-chip over">{statusLabel.over}: {totals.over}</span>
            <span className="sum-chip missing">{statusLabel.missing}: {totals.missing}</span>
            <span className="sum-chip under">{statusLabel.under}: {totals.under}</span>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginInlineStart: 'auto' }}>
              <input type="checkbox" checked={onlyExceptions} onChange={(e) => setOnlyExceptions(e.target.checked)} />
              {t('report.summary.onlyExceptions')}
            </label>
          </div>

          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <table className="xl sum-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>{t('report.th.employee')}</th>
                  <th>{t('report.th.empNo')}</th>
                  <th>{t('report.summary.th.reported')}</th>
                  <th>{t('report.summary.th.standard')}</th>
                  <th>{t('report.summary.th.diff')}</th>
                  <th>{t('report.summary.th.status')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const diff = round2(l.reported - l.target);
                  return (
                    <tr key={l.num} className={`sum-${l.status}`}>
                      <td style={{ textAlign: 'start' }} title={l.name}>
                        {l.nick} <span className="mini">{l.name}</span>
                      </td>
                      <td>{l.num}</td>
                      <td className="num">{l.reported}</td>
                      <td className="num">{l.target}</td>
                      <td className="num" dir="ltr">
                        {diff > 0 ? `+${diff}` : diff}
                      </td>
                      <td>{statusLabel[l.status]}</td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="mini">
                      {t('report.summary.none')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
