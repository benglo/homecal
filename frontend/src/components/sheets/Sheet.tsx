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
}

/** Bottom-sheet modal primitive for every editor + DayDetail.
 *  Tap-out / Escape to dismiss, scroll-locked, basic focus management;
 *  preserves the background context underneath (it stays visible, dimmed). */
export function Sheet({ open, onClose, title, actions, children }: Props) {
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
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, stableClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: 'rgba(12,10,9,0.45)' }}
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
        className="bg-surface w-full outline-none"
        style={{
          borderTopLeftRadius: 'var(--r-lg)',
          borderTopRightRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow)',
          maxHeight: '92vh',
          animation: 'sheet-up 240ms var(--ease)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <header className="flex items-center justify-between border-b border-border" style={{ padding: '16px 20px' }}>
          <h2 className="font-semibold text-text" style={{ fontSize: 19 }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center rounded-full text-text-muted"
            style={{ width: 40, height: 40, marginRight: -8 }}
          >
            <X size={22} />
          </button>
        </header>

        <div className="overflow-y-auto" style={{ padding: '20px', maxHeight: 'calc(92vh - 140px)' }}>
          {children}
        </div>

        {actions && (
          <footer
            className="flex items-center justify-end gap-3 border-t border-border bg-surface"
            style={{ padding: '14px 20px' }}
          >
            {actions}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
