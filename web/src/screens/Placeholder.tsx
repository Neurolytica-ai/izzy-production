import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';

/**
 * Honest stub for a tab whose screen is not built yet.
 *
 * Says which phase it belongs to rather than showing an empty panel, so a
 * half-built app cannot be mistaken for a broken one during a demo.
 */
const WHAT: Record<number, StringKey> = {
  2: 'placeholder.what.2',
  3: 'placeholder.what.3',
  4: 'placeholder.what.4',
};

export function Placeholder({ title, phase }: { title: string; phase: number }) {
  const t = useT();
  const whatKey = WHAT[phase];
  const what = whatKey ? t(whatKey) : t('placeholder.whatDefault');
  return (
    <div className="card">
      <div className="section-title">{title}</div>
      <div className="empty">
        {t('placeholder.notBuilt', { phase, what })}
        <div className="mini" style={{ marginTop: 10 }}>
          {t('placeholder.behind')}
        </div>
      </div>
    </div>
  );
}
