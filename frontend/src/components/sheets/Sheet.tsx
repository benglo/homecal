import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Footer action buttons (right-aligned). */
  actions?: ReactNode;
  children: ReactNode;
  /** 'modal' = centered dialog (default), 'sheet' = bottom sheet. */
  variant?: 'modal' | 'sheet';
}

export function Sheet({ open, onClose, title, actions, children, variant = 'modal' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stableClose = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stableClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Only grab focus if a child (e.g. an autoFocus input) hasn't already taken
    // it — otherwise we blur that field, which makes the wall's VirtualKeyboard
    // flash open then closed as focus lands on the non-input panel.
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, stableClose]);

  if (!open) return null;

  const isSheet = variant === 'sheet';

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex flex-col ${isSheet ? 'justify-end' : 'items-center justify-center'}`}
      style={{ background: 'rgba(12,10,9,0.45)', paddingBottom: 'var(--kb-height, 0px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) stableClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="bg-surface outline-none"
        style={{
          borderRadius: isSheet ? 'var(--r-lg) var(--r-lg) 0 0' : 'var(--r-lg)',
          boxShadow: 'var(--shadow)',
          maxHeight: 'calc(92vh - var(--kb-height, 0px))',
          marginBottom: isSheet ? 'var(--kb-height, 0px)' : undefined,
          width: isSheet ? '100%' : 'min(640px, 92vw)',
          paddingBottom: isSheet ? 'env(safe-area-inset-bottom, 0px)' : undefined,
        }}
      >
        <header className="flex items-center justify-between border-b border-border" style={{ padding: '16px 24px' }}>
          <h2 className="font-semibold text-text" style={{ fontSize: 19 }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center rounded-full bg-surface-2 text-text-muted"
            style={{ width: 48, height: 48, marginRight: -10 }}
          >
            <X size={28} />
          </button>
        </header>

        <div className="overflow-y-auto" style={{ padding: '20px 24px', maxHeight: 'calc(92vh - var(--kb-height, 0px) - 168px)' }}>
          {children}
        </div>

        {actions && (
          <footer
            className="flex items-center justify-end gap-4 border-t border-border bg-surface"
            style={{
              padding: '16px 24px',
              borderRadius: isSheet ? undefined : '0 0 var(--r-lg) var(--r-lg)',
            }}
          >
            {actions}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
