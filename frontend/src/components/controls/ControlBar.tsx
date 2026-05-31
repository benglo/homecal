import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Category, WallView } from '../../core/model/types';

interface Props {
  view: WallView;
  onView: (v: WallView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isToday: boolean;
  categories: Category[];
  onQuickAdd: () => void;
}

const VIEWS: WallView[] = ['agenda', 'week', 'month'];

export function ControlBar({ view, onView, onPrev, onNext, onToday, isToday, categories, onQuickAdd }: Props) {
  return (
    <div className="flex shrink-0 items-center justify-between bg-surface-2 border-t border-border" style={{ height: 88, padding: '0 24px', gap: 16 }}>
      <div className="flex items-center gap-4">
        <div className="inline-flex bg-surface border border-border rounded-full p-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              onClick={() => onView(v)}
              className="rounded-full font-semibold capitalize transition-colors"
              style={{
                fontSize: 18,
                padding: '16px 28px',
                minHeight: 64,
                background: v === view ? 'var(--accent)' : 'transparent',
                color: v === view ? '#fff' : 'var(--text-muted)',
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <NavBtn onClick={onPrev} ariaLabel="Previous"><ChevronLeft size={26} /></NavBtn>
          <button
            type="button"
            onClick={onToday}
            disabled={isToday}
            className="rounded-full font-semibold"
            style={{ fontSize: 17, padding: '14px 22px', minHeight: 64, color: isToday ? 'var(--text-faint)' : 'var(--text)' }}
          >
            Today
          </button>
          <NavBtn onClick={onNext} ariaLabel="Next"><ChevronRight size={26} /></NavBtn>
        </div>
      </div>

      <div className="flex items-center gap-4 text-text-faint" style={{ fontSize: 15 }}>
        {categories.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5">
            <span className="rounded-sm" style={{ width: 11, height: 11, background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onQuickAdd}
        aria-label="Quick add"
        className="grid place-items-center rounded-full shrink-0"
        style={{ width: 72, height: 72, background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
      >
        <Plus size={32} strokeWidth={2.4} />
      </button>
    </div>
  );
}

function NavBtn({ onClick, ariaLabel, children }: { onClick: () => void; ariaLabel: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="grid place-items-center rounded-full text-text-muted"
      style={{ width: 64, height: 64 }}
    >
      {children}
    </button>
  );
}
