import type { Category, EventOccurrence } from '../../core/model/types';
import { fmtTime } from '../../core/util/time';
import { CategoryChip } from './CategoryChip';

interface Props {
  occ: EventOccurrence;
  category?: Category;
  onTap?: (occ: EventOccurrence) => void;
}

/** One agenda line: colour bar · time · title (ellipsis) · chip · location. */
export function EventRow({ occ, category, onTap }: Props) {
  return (
    <button
      type="button"
      onClick={() => onTap?.(occ)}
      className="flex items-center gap-5 w-full text-left border-b border-border last:border-0"
      style={{ minHeight: 84, paddingRight: 18 }}
    >
      <span
        className="rounded-full shrink-0"
        style={{ width: 5, height: 52, background: category?.color ?? 'var(--c-uncat)' }}
      />
      <span
        className="shrink-0 font-mono font-medium"
        style={{ width: 104, fontSize: occ.allDay ? 15 : 24, letterSpacing: '-0.02em' }}
      >
        {occ.allDay ? <span className="uppercase tracking-wide text-text-faint">All day</span> : fmtTime(occ.start, false)}
      </span>
      <span className="flex-1 min-w-0 truncate font-semibold" style={{ fontSize: 26, letterSpacing: '-0.01em' }}>
        {occ.title}
        {occ.location && <span className="text-text-muted font-normal" style={{ fontSize: 20 }}>{' · '}{occ.location}</span>}
      </span>
      <CategoryChip category={category} size="wall" />
    </button>
  );
}
