import { useRef, useState } from 'react';
import { ApiError, api, type CurrentUser } from '../api/client.ts';
import { useT } from '../i18n/index.tsx';

interface Props {
  onSignedIn: (user: CurrentUser) => void;
  /** A non-auth failure from the initial session check, e.g. the server is down. */
  error: ApiError | null;
}

/**
 * Typed input survives anything that re-renders or remounts this screen (client
 * feedback 2026-08-03 #1: "what was typed in the username disappears" when focus
 * moves to the password). The fields are uncontrolled — React never writes their
 * value, so no render can clobber what the browser holds — and the username is
 * mirrored into module scope so even a full remount restores it. The password is
 * deliberately not kept anywhere.
 */
let typedUsername = '';

export function LoginScreen({ onSignedIn, error }: Props) {
  const t = useT();
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const username = usernameRef.current?.value.trim() ?? '';
    const password = passwordRef.current?.value ?? '';
    setBusy(true);
    setFailure(null);
    try {
      const user = await api.auth.login(username, password);
      typedUsername = '';
      onSignedIn(user);
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
          name="username"
          ref={usernameRef}
          defaultValue={typedUsername}
          onChange={(e) => {
            typedUsername = e.target.value;
          }}
          autoComplete="username"
          autoFocus
          required
          style={{ width: '100%', marginBottom: 12 }}
        />

        <label htmlFor="password">{t('login.password')}</label>
        <input
          id="password"
          name="password"
          type="password"
          ref={passwordRef}
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
