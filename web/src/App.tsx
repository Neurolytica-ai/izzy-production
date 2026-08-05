import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api/client.ts';
import { keys, useMe } from './api/hooks.ts';
import { useHashTab } from './useHashTab.ts';
import { LangToggle, useT } from './i18n/index.tsx';
import type { StringKey } from './i18n/strings.ts';
import { ArchiveScreen } from './screens/ArchiveScreen.tsx';
import { LoginScreen } from './screens/LoginScreen.tsx';
import { LogScreen } from './screens/LogScreen.tsx';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { MasterScreen } from './screens/MasterScreen.tsx';
import { Placeholder } from './screens/Placeholder.tsx';
import { ReportScreen } from './screens/ReportScreen.tsx';
import { UsersScreen } from './screens/UsersScreen.tsx';

/**
 * The seven tabs from the prototype, in its order. Kept even where the screen is
 * not built yet, so the shape of the finished app is visible and the nav does not
 * shuffle around as screens land. Labels are translation keys — see i18n/strings.
 */
const TABS = [
  { id: 'report', labelKey: 'tab.report', phase: 2 },
  { id: 'archive', labelKey: 'tab.archive', phase: 2 },
  // Coverage + dashboard are reverted to their "later phase" placeholders at the
  // client's request (feedback round 2 #3): the Phase-4 screens still exist and
  // are tested, but are not shown yet. Re-enabling is one line each below.
  { id: 'coverage', labelKey: 'tab.coverage', phase: 4 },
  { id: 'dash', labelKey: 'tab.dash', phase: 4 },
  { id: 'import', labelKey: 'tab.import', phase: 3 },
  { id: 'master', labelKey: 'tab.master', phase: 1 },
  { id: 'users', labelKey: 'tab.users', phase: 1, adminOnly: true },
  { id: 'log', labelKey: 'tab.log', phase: 4 },
] as const satisfies readonly {
  id: string;
  labelKey: StringKey;
  phase: number;
  adminOnly?: boolean;
}[];

export type TabId = (typeof TABS)[number]['id'];
const TAB_IDS = TABS.map((tab) => tab.id);

export function App() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useHashTab<TabId>(TAB_IDS as readonly TabId[], 'master');

  const authFailed = me.error instanceof ApiError && me.error.isAuthFailure;

  if (me.isLoading) {
    return <div className="empty" style={{ paddingTop: 60 }}>{t('common.loading')}</div>;
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

  const current = TABS.find((tab_) => tab_.id === tab)!;

  return (
    <>
      <header>
        <div>
          <h1>{t('app.title')}</h1>
          <div className="sub">{t('app.subtitle')}</div>
        </div>
        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <LangToggle />
          <div style={{ fontSize: 12, color: '#fff' }}>
            👤 {user.display_name} <span style={{ opacity: 0.75 }}>({user.role})</span>
          </div>
          <button className="btn ghost sm" onClick={signOut}>
            {t('common.signOut')}
          </button>
        </div>
      </header>

      <nav>
        {TABS.filter(
          (tab_) => !('adminOnly' in tab_ && tab_.adminOnly) || user.role === 'admin'
        ).map((tab_) => (
          <button
            key={tab_.id}
            className={tab_.id === tab ? 'active' : ''}
            onClick={() => setTab(tab_.id)}
          >
            {t(tab_.labelKey)}
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
        ) : tab === 'users' && user.role === 'admin' ? (
          <UsersScreen />
        ) : tab === 'log' ? (
          <LogScreen role={user.role} />
        ) : tab === 'import' ? (
          <ImportScreen role={user.role} />
        ) : (
          // coverage + dash (feedback round 2 #3) and any not-yet-built tab land
          // on the honest "later phase" placeholder.
          <Placeholder title={t(current.labelKey)} phase={current.phase} />
        )}
      </main>
    </>
  );
}
