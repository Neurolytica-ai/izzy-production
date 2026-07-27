import { useCallback, useEffect, useState } from 'react';

/**
 * Tab state kept in the URL hash.
 *
 * Deliberately not a router. Seven fixed tabs need deep-linking and
 * survive-a-refresh, not nested routes or data loaders — and the obvious
 * candidate (react-router) currently ships a high-severity CSRF advisory that
 * would have meant explaining an irrelevant finding to the client's scanner.
 */
export function useHashTab<T extends string>(
  valid: readonly T[],
  fallback: T
): [T, (next: T) => void] {
  const read = useCallback((): T => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    return (valid as readonly string[]).includes(raw) ? (raw as T) : fallback;
  }, [valid, fallback]);

  const [tab, setTab] = useState<T>(read);

  useEffect(() => {
    const onChange = () => setTab(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [read]);

  // Normalise an absent or unrecognised hash so the address bar matches what is
  // actually on screen.
  useEffect(() => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    if (!(valid as readonly string[]).includes(raw)) {
      window.history.replaceState(null, '', `#/${fallback}`);
    }
  }, [valid, fallback]);

  const select = useCallback((next: T) => {
    window.location.hash = `/${next}`;
  }, []);

  return [tab, select];
}
