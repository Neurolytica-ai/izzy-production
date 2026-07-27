/**
 * Honest stub for a tab whose screen is not built yet.
 *
 * Says which phase it belongs to rather than showing an empty panel, so a
 * half-built app cannot be mistaken for a broken one during a demo.
 */
const WHAT: Record<number, string> = {
  2: 'Reports API and the hours-entry grid',
  3: 'Server-side Excel import and export',
  4: 'Attendance cross-check, dashboard and activity log',
};

export function Placeholder({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="card">
      <div className="section-title">{title}</div>
      <div className="empty">
        Not built yet — Phase {phase}: {WHAT[phase] ?? 'in progress'}.
        <div className="mini" style={{ marginTop: 10 }}>
          The API and database behind this screen already exist and are tested; only
          the interface is outstanding.
        </div>
      </div>
    </div>
  );
}
