import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Overlay dialog. Reuses the prototype's .confirm-ov / .confirm-box styling so it
 * looks the same as the dialogs the users already know.
 */
export function Modal({ title, onClose, children, footer }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Move focus into the dialog so keyboard users are not left behind the
    // overlay, and Escape reaches the handler above.
    box.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="confirm-ov"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="confirm-box"
        ref={box}
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 420, textAlign: 'start' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-msg">{title}</div>
        {children}
        {footer && <div className="confirm-btns" style={{ marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmProps {
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ConfirmDialog({
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmProps) {
  return (
    <div className="confirm-ov" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-box" role="dialog" aria-modal="true">
        <div className="confirm-msg">{message}</div>
        <div className="confirm-btns">
          <button className="btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
