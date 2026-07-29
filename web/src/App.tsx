import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api/client.ts';
import { keys, useAppConfig, useMe } from './api/hooks.ts';
import { useHashTab } from './useHashTab.ts';
import { ArchiveScreen } from './screens/ArchiveScreen.tsx';
import { LoginScreen } from './screens/LoginScreen.tsx';
import { MasterScreen } from './screens/MasterScreen.tsx';
import { Placeholder } from './screens/Placeholder.tsx';
import { ReportScreen } from './screens/ReportScreen.tsx';

/**
 * The seven tabs from the prototype, in its order. Kept even where the screen is
 * not built yet, so the shape of the finished app is visible and the nav does not
 * shuffle around as screens land.
 */
const TABS = [
  { id: 'report', label: '📋 Hours Reporting', phase: 2 },
  { id: 'archive', label: '📚 Reports Archive', phase: 2 },
  { id: 'coverage', label: '🟢 Attendance Cross-Check', phase: 4 },
  { id: 'dash', label: '📊 Dashboard', phase: 4 },
  { id: 'import', label: '⬆️ Excel Import', phase: 3 },
  { id: 'master', label: '🗂️ Master Data', phase: 1 },
  { id: 'log', label: '🧾 Activity Log', phase: 4 },
] as const;

export type TabId = (typeof TABS)[number]['id'];
const TAB_IDS = TABS.map((t) => t.id);

export function App() {
  const config = useAppConfig();
  const me = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useHashTab<TabId>(TAB_IDS as readonly TabId[], 'master');

  // Document language and direction come from the server so UI_LANG is the single
  // source of truth, rather than being hardcoded in index.html as well.
  useEffect(() => {
    if (!config.data) return;
    document.documentElement.lang = config.data.lang;
    document.documentElement.dir = config.data.dir;
  }, [config.data]);

  const authFailed = me.error instanceof ApiError && me.error.isAuthFailure;

  if (me.isLoading) {
    return <div className="empty" style={{ paddingTop: 60 }}>Loading…</div>;
  }

  if (authFailed || !me.data) {
    return (
      <LoginScreen
        onSignedIn={(user) => {
          // Seed the cache so the shell renders without a second round-trip.
          qc.setQueryData(keys.me, user);
        }}
        error={me.error instanceof ApiError && !authFailed ? me.error : null}
      />
    );
  }

  const user = me.data;

  const signOut = async () => {
    try {
      await api.auth.logout();
    } finally {
      // Clear everything: another user may sign in on this machine, and stale
      // master data in the cache would be the least of it.
      qc.clear();
    }
  };

  return (
    <>
      <header>
        <div>
          <h1>Izzy Yogev Technologies — Production Management &amp; Control</h1>
          <div className="sub">Hours reporting · attendance cross-check · standard-hours control</div>
        </div>
        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: '#fff' }}>
            👤 {user.display_name} <span style={{ opacity: 0.75 }}>({user.role})</span>
          </div>
          <button className="btn ghost sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <nav>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'report' ? (
          <ReportScreen />
        ) : tab === 'archive' ? (
          <ArchiveScreen role={user.role} />
        ) : tab === 'master' ? (
          <MasterScreen role={user.role} />
        ) : (
          <Placeholder
            title={TABS.find((t) => t.id === tab)!.label}
            phase={TABS.find((t) => t.id === tab)!.phase}
          />
        )}
      </main>
    </>
  );
}
