/**
 * Runtime i18n: a tiny context + hook, no library.
 *
 * Why not react-i18next: two languages, ~150 keys, no pluralisation rules, no
 * lazy namespaces. A context and a lookup are the whole requirement; a library
 * would be more moving parts than the thing it replaces.
 *
 * The chosen language is persisted per-browser (localStorage), so each user's
 * choice sticks across reloads. Default is Hebrew — the Izzy Yogev staff are
 * Hebrew-speaking; developers toggle to English once and the browser remembers.
 * Switching also flips <html dir/lang>, which is what drives the RTL layout.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { STRINGS, type Lang, type StringKey } from './strings.ts';

const STORAGE_KEY = 'izy_lang';
const DEFAULT_LANG: Lang = 'he';

/**
 * Client feedback 2026-08-03 #9: no English option at this stage — it may come
 * back later as additional development. While off, the header button is not
 * rendered and any previously-saved 'en' choice is ignored (otherwise a user
 * who had toggled to English would be stuck there with no way back). The full
 * catalogue and toggle machinery stay: re-enabling is this one flag.
 */
const ENGLISH_ENABLED = false;

function readInitial(): Lang {
  if (!ENGLISH_ENABLED) return DEFAULT_LANG;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'he') return saved;
  } catch {
    /* private-mode / disabled storage — fall through to the default */
  }
  return DEFAULT_LANG;
}

export type TFunction = (key: StringKey, params?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: TFunction;
  setLang: (lang: Lang) => void;
  toggle: () => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial);
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* nothing we can do if storage is unavailable; the choice still applies this session */
    }
  }, []);

  const toggle = useCallback(() => setLang(lang === 'he' ? 'en' : 'he'), [lang, setLang]);

  const t = useCallback<TFunction>(
    (key, params) => {
      const entry = STRINGS[key];
      let text = entry ? entry[lang] : (key as string);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [lang]
  );

  const value = useMemo<I18n>(() => ({ lang, dir, t, setLang, toggle }), [lang, dir, t, setLang, toggle]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}

/** Convenience for components that only need the translate function. */
export function useT(): TFunction {
  return useI18n().t;
}

/**
 * The header language switch. Shows the language it will switch *to*, which is
 * the convention users expect from a language button.
 */
export function LangToggle() {
  const { lang, toggle } = useI18n();
  if (!ENGLISH_ENABLED) return null;
  return (
    <button
      className="btn ghost sm"
      onClick={toggle}
      title={lang === 'he' ? 'Switch to English' : 'עבור לעברית'}
      aria-label={lang === 'he' ? 'Switch to English' : 'עבור לעברית'}
    >
      🌐 {lang === 'he' ? 'English' : 'עברית'}
    </button>
  );
}
