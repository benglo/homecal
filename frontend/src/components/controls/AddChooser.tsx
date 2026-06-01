import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Utensils } from 'lucide-react';
import type { Category } from '../../core/model/types';
import { chipFill, fgForBg } from '../../core/util/color';
import { iconFor } from '../../core/util/icons';

const DINNER_CATEGORY_ID = 'cat-dinner';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  onCategory: (id: string) => void;
  onDinner: () => void;
}

export function AddChooser({ open, onClose, categories, onCategory, onDinner }: Props) {
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

  const dinnerCat = categories.find((c) => c.id === DINNER_CATEGORY_ID);
  const eventCats = categories.filter((c) => c.id !== DINNER_CATEGORY_ID);
  const dinnerColor = dinnerCat?.color ?? '#D55E00';
  const DinnerIcon = dinnerCat ? iconFor(dinnerCat.icon) : Utensils;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(12,10,9,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) stableClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="What are you adding?"
        tabIndex={-1}
        className="outline-none"
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow)',
          padding: '28px 32px',
          width: 'min(680px, 90vw)',
        }}
      >
        <h2
          className="font-semibold text-text"
          style={{ fontSize: 22, marginBottom: 24 }}
        >
          What are you adding?
        </h2>

        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
        >
          {eventCats.map((c) => {
            const Icon = iconFor(c.icon);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onCategory(c.id)}
                className="flex items-center gap-3 rounded-lg border font-semibold"
                style={{
                  minHeight: 80,
                  padding: '16px 20px',
                  fontSize: 18,
                  background: chipFill(c.color, 0.12),
                  borderColor: c.color,
                  borderWidth: 2,
                  color: fgForBg(c.color) === '#000000' ? 'var(--text)' : c.color,
                }}
              >
                <Icon size={26} strokeWidth={2} style={{ color: c.color }} />
                {c.name}
              </button>
            );
          })}
        </div>

        <div
          className="border-t border-border"
          style={{ marginTop: 20, paddingTop: 20 }}
        >
          <button
            type="button"
            onClick={onDinner}
            className="flex items-center gap-3 rounded-lg border font-semibold w-full"
            style={{
              minHeight: 80,
              padding: '16px 20px',
              fontSize: 18,
              background: chipFill(dinnerColor, 0.12),
              borderColor: dinnerColor,
              borderWidth: 2,
              color: dinnerColor,
            }}
          >
            <DinnerIcon size={26} strokeWidth={2} />
            {dinnerCat?.name ?? 'Dinner'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
