import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The reporting grid's autocomplete cell — a faithful port of the prototype's
 * `setupAC` (:452), which the users already have in their fingers:
 *
 *   - substring search on nickname / name / number, shown as "main · sub";
 *   - ArrowUp/Down move the highlight, Enter picks it, Escape closes;
 *   - picking, or pressing Enter with nothing to pick, advances to the next cell
 *     in the same row; Enter on the last cell calls `onEnterEnd` (the grid uses
 *     that to commit the draft row).
 *
 * Two deliberate differences from the prototype:
 *
 *   - Suggestions come from the server (`api.lookup.*`) rather than an in-memory
 *     array, so the grid never holds a stale copy of master data. Requests are
 *     debounced and stamped with a sequence number, so a slow earlier response
 *     cannot overwrite a newer one.
 *   - The dropdown is rendered through a portal with `position: fixed`. Inside the
 *     grid's `overflow:auto` scroller an absolutely-positioned list would be
 *     clipped; the prototype dodged this by appending to <body>, and so do we.
 */

export interface AcSuggestion<T> {
  main: string;
  sub: string;
  value: T;
}

interface Props<T> {
  value: string;
  search: (q: string) => Promise<AcSuggestion<T>[]>;
  /** User typed; the parent should clear any previously-resolved key for this field. */
  onType: (text: string) => void;
  /** User chose a suggestion. */
  onPick: (value: T) => void;
  /** Enter pressed with no next cell to move to — the grid commits the draft here. */
  onEnterEnd?: () => void;
  /** Called when the field loses focus, after the dropdown has closed. */
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Rendered inside the cell before the input — the employee status dot. */
  adornment?: ReactNode;
}

/**
 * Focus the next enabled `[data-grid-input]` in the same row and select its
 * contents. Returns false when there is no next cell, which is the grid's cue to
 * commit a draft row.
 */
export function advanceWithinRow(from: HTMLElement): boolean {
  const row = from.closest('tr');
  if (!row) return false;
  const inputs = [...row.querySelectorAll<HTMLElement>('[data-grid-input]:not([disabled])')];
  const i = inputs.indexOf(from);
  const next = i >= 0 ? inputs[i + 1] : undefined;
  if (!next) return false;
  next.focus();
  if (next instanceof HTMLInputElement) {
    try {
      next.select();
    } catch {
      /* number/date inputs reject select() in some browsers */
    }
  }
  return true;
}

const DEBOUNCE_MS = 150;

export function AutocompleteCell<T>({
  value,
  search,
  onType,
  onPick,
  onEnterEnd,
  onBlur,
  disabled,
  placeholder,
  ariaLabel,
  adornment,
}: Props<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<AcSuggestion<T>[]>([]);
  const [hl, setHl] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // A monotonic request id: only the newest search is allowed to set state, so a
  // slow response for an earlier keystroke cannot clobber a newer one.
  const seq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runSearch = (q: string) => {
    const id = ++seq.current;
    void search(q).then((results) => {
      if (id !== seq.current) return;
      setMatches(results);
      setHl(0);
      setOpen(results.length > 0);
    });
  };

  const openFor = (q: string) => {
    setRect(inputRef.current?.getBoundingClientRect() ?? null);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  };

  const close = () => {
    seq.current++; // invalidate any in-flight search
    clearTimeout(debounce.current);
    setOpen(false);
    setMatches([]);
  };

  useEffect(() => () => clearTimeout(debounce.current), []);

  // Keep the dropdown pinned to the input while the page or a scroller moves.
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => setRect(inputRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const pick = (i: number) => {
    const m = matches[i];
    if (!m) return;
    onPick(m.value);
    close();
    if (inputRef.current && !advanceWithinRow(inputRef.current)) onEnterEnd?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHl((h) => Math.min(h + 1, matches.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHl((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        pick(hl);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!advanceWithinRow(e.currentTarget)) onEnterEnd?.();
    }
  };

  return (
    <td style={{ position: 'relative' }}>
      {adornment && (
        <span style={{ position: 'absolute', top: 11, insetInlineEnd: 6, zIndex: 1 }}>{adornment}</span>
      )}
      <input
        ref={inputRef}
        data-grid-input
        type="text"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        style={adornment ? { paddingInlineEnd: 20 } : undefined}
        onChange={(e) => {
          onType(e.target.value);
          openFor(e.target.value.trim());
        }}
        onFocus={(e) => openFor(e.target.value.trim())}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so a mousedown on a suggestion is handled before the list is
          // torn down (the item's onMouseDown preventDefault keeps focus, but the
          // close still has to lose the race).
          setTimeout(() => {
            close();
            onBlur?.();
          }, 150);
        }}
      />
      {open && rect &&
        createPortal(
          <div
            className="ac-list"
            style={{
              position: 'fixed',
              top: rect.bottom,
              minWidth: Math.max(rect.width, 260),
              // Anchor to the cell's start edge in both directions: under RTL the
              // list must hang off the input's right edge, not its left, or it
              // drifts off toward the wrong side of the screen.
              ...(document.documentElement.dir === 'rtl'
                ? { right: window.innerWidth - rect.right }
                : { left: rect.left }),
            }}
          >
            {matches.map((m, i) => (
              <div
                key={i}
                className={`ac-item ${i === hl ? 'hl' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                {m.main} <span className="n2">{m.sub}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </td>
  );
}
