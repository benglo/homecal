import type { Category, EventOccurrence } from '../../core/model/types';
import { fmtTime } from '../../core/util/time';
import { CategoryChip } from './CategoryChip';

interface Props {
  occ: EventOccurrence;
  category?: Category;
  density?: 'wall' | 'phone';
  onTap?: (occ: EventOccurrence) => void;
}

/** One agenda line: colour bar · time · title (ellipsis) · chip · location. */
export function EventRow({ occ, category, density = 'wall', onTap }: Props) {
  const wall = density === 'wall';
  return (
    <button
      type="button"
      onClick={() => onTap?.(occ)}
      className="flex items-center w-full text-left border-b border-border last:border-0"
      style={{ minHeight: wall ? 84 : 56, gap: wall ? 20 : 12, paddingRight: wall ? 18 : 4 }}
    >
      <span
        className="rounded-full shrink-0"
        style={{ width: wall ? 5 : 4, height: wall ? 52 : 34, background: category?.color ?? 'var(--c-uncat)' }}
      />
      <span
        className="shrink-0 font-mono font-medium"
        style={{ width: wall ? 104 : 60, fontSize: occ.allDay ? (wall ? 15 : 12) : wall ? 24 : 15, letterSpacing: '-0.02em' }}
      >
        {occ.allDay ? <span className="uppercase tracking-wide text-text-faint">All day</span> : fmtTime(occ.start, false)}
      </span>
      <span className="flex-1 min-w-0 truncate font-semibold" style={{ fontSize: wall ? 26 : 16, letterSpacing: '-0.01em' }}>
        {occ.title}
        {occ.location && (
          <span className="text-text-muted font-normal" style={{ fontSize: wall ? 20 : 13 }}>
            {' · '}
            {occ.location}
          </span>
        )}
      </span>
      {/* Always icon + label (spec §0: colour is never the only signal). */}
      <CategoryChip category={category} size={wall ? 'wall' : 'phone'} />
    </button>
  );
}
