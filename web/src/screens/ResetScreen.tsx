import { useRef, useState } from 'react';
import { ApiError, api } from '../api/client.ts';
import { useT } from '../i18n/index.tsx';

/**
 * Lands here from the emailed link (…/#reset=<token> — see App.tsx routing).
 * The token is only validated when the form is submitted: probing it on mount
 * would let anyone scanning URLs distinguish live tokens from dead ones
 * without ever setting a password.
 */
export function ResetScreen({ token }: { token: string }) {
  const t = useT();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const backToLogin = () => {
    // Drop the token from the URL and boot cleanly onto the login screen.
    window.location.href = window.location.pathname;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const password = passwordRef.current?.value ?? '';
    if (password !== (confirmRef.current?.value ?? '')) {
      setFailure(t('reset.mismatch'));
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await api.auth.reset(token, password);
      setDone(true);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : t('common.saveFailed'));
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
          {t('reset.title')}
        </div>

        {done ? (
          <>
            <div className="pill g" style={{ display: 'block', padding: '8px 12px', marginBottom: 14 }}>
              {t('reset.success')}
            </div>
            <button className="btn" type="button" onClick={backToLogin} style={{ width: '100%' }}>
              {t('reset.backToLogin')}
            </button>
          </>
        ) : (
          <>
            <label htmlFor="new-password">{t('reset.newPassword')}</label>
            <input
              id="new-password"
              type="password"
              ref={passwordRef}
              autoComplete="new-password"
              autoFocus
              required
              style={{ width: '100%', marginBottom: 12 }}
            />

            <label htmlFor="confirm-password">{t('reset.confirmPassword')}</label>
            <input
              id="confirm-password"
              type="password"
              ref={confirmRef}
              autoComplete="new-password"
              required
              style={{ width: '100%', marginBottom: 16 }}
            />

            <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? t('common.saving') : t('reset.submit')}
            </button>

            <button
              type="button"
              className="mini"
              onClick={backToLogin}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                marginTop: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {t('reset.backToLogin')}
            </button>

            {failure && (
              <div className="pill r" style={{ display: 'block', marginTop: 14, padding: '8px 12px' }}>
                {failure}
              </div>
            )}
          </>
        )}
      </form>
    </div>
  );
}
