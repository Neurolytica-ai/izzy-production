import { useCallback, useEffect, useState } from 'react';

export type ToastTone = 'ok' | 'error';

interface ToastState {
  message: string;
  tone: ToastTone;
  /** Bumped on every show so an identical message still restarts the timer. */
  seq: number;
}

/**
 * Transient confirmation, matching the prototype's toast. Errors stay up longer
 * than successes — a failure the user misses is a failure they think succeeded.
 */
export function useToast() {
  const [state, setState] = useState<ToastState | null>(null);

  const show = useCallback((message: string, tone: ToastTone = 'ok') => {
    setState((prev) => ({ message, tone, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!state) return;
    const ms = state.tone === 'error' ? 6000 : 2400;
    const timer = setTimeout(() => setState(null), ms);
    return () => clearTimeout(timer);
  }, [state]);

  const node = state ? (
    <div
      className="toast show"
      role="status"
      aria-live="polite"
      style={state.tone === 'error' ? { background: '#c0392b' } : undefined}
    >
      {state.message}
    </div>
  ) : null;

  return { show, node } as const;
}
