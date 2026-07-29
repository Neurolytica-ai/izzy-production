import { useState } from 'react';
import { ApiError, api, type CurrentUser } from '../api/client.ts';
import { useT } from '../i18n/index.tsx';

interface Props {
  onSignedIn: (user: CurrentUser) => void;
  /** A non-auth failure from the initial session check, e.g. the server is down. */
  error: ApiError | null;
}

export function LoginScreen({ onSignedIn, error }: Props) {
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      onSignedIn(await api.auth.login(username, password));
    } catch (err) {
      // The server returns one message for every failure mode by design, so
      // there is nothing to add here — show what it said.
      setFailure(err instanceof ApiError ? err.message : t('login.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        className="card"
        onSubmit={submit}
        style={{ width: '100%', maxWidth: 360, padding: 24 }}
      >
        <div className="section-title" style={{ fontSize: 17, marginBottom: 4 }}>
          {t('login.title')}
        </div>
        <div className="mini" style={{ marginBottom: 18 }}>
          {t('login.subtitle')}
        </div>

        <label htmlFor="username">{t('login.username')}</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          style={{ width: '100%', marginBottom: 12 }}
        />

        <label htmlFor="password">{t('login.password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          style={{ width: '100%', marginBottom: 16 }}
        />

        <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>

        {failure && (
          <div className="pill r" style={{ display: 'block', marginTop: 14, padding: '8px 12px' }}>
            {failure}
          </div>
        )}

        {error && (
          <div className="pill y" style={{ display: 'block', marginTop: 14, padding: '8px 12px' }}>
            {error.message}
          </div>
        )}
      </form>
    </div>
  );
}
