import { DateTime } from 'luxon';
import { MapPin, Repeat } from 'lucide-react';
import type { Category, EventOccurrence } from '../../core/model/types';
import { dayKey, fmtTime, ZONE } from '../../core/util/time';
import { CategoryChip } from '../primitives/CategoryChip';
import { Sheet } from './Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  date: string | null; // yyyy-MM-dd (Brisbane)
  occurrences: EventOccurrence[];
  categories: Map<string, Category>;
  dinner?: string;
  /** Optional — when provided, tapping an event opens the editor (phone). */
  onEdit?: (occ: EventOccurrence) => void;
}

/** Read view of a single day, opened by tapping an event/day on the wall. */
export function DayDetailSheet({ open, onClose, date, occurrences, categories, dinner, onEdit }: Props) {
  if (!open || !date) return null;

  const dayEvents = occurrences
    .filter((o) => dayKey(o.start) === date)
    .sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1));
  const pretty = DateTime.fromISO(date, { zone: ZONE }).toFormat('cccc d LLLL');

  return (
    <Sheet open onClose={onClose} title={pretty} variant="sheet">
      {dinner && (
        <div className="rounded-md" style={{ background: 'var(--accent-weak)', color: 'var(--accent-ink)', padding: '12px 14px', marginBottom: 16, fontSize: 15 }}>
          🍽 Dinner — {dinner}
        </div>
      )}

      {dayEvents.length === 0 ? (
        <p className="text-text-muted">Nothing scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dayEvents.map((o) => {
            const Row = onEdit ? 'button' : 'div';
            return (
              <li key={o.id}>
                <Row
                  {...(onEdit ? { type: 'button' as const, onClick: () => onEdit(o) } : {})}
                  className="flex items-start gap-3 w-full text-left rounded-md border border-border"
                  style={{ padding: '14px 16px', minHeight: onEdit ? 56 : undefined, background: 'var(--surface)' }}
                >
                  <span
                    className="rounded-full shrink-0"
                    style={{ width: 6, alignSelf: 'stretch', background: categories.get(o.categoryId)?.color ?? 'var(--c-uncat)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                      <span className="font-mono text-text-muted" style={{ fontSize: 14 }}>
                        {fmtTime(o.start, o.allDay)}
                      </span>
                      {o.isRecurring && <Repeat size={14} className="text-text-faint" />}
                    </div>
                    <div className="font-semibold text-text" style={{ fontSize: 16 }}>
                      {o.title}
                    </div>
                    {o.location && (
                      <div className="flex items-center gap-1 text-text-muted" style={{ fontSize: 14, marginTop: 3 }}>
                        <MapPin size={13} /> {o.location}
                      </div>
                    )}
                  </div>
                  <CategoryChip category={categories.get(o.categoryId)} size="phone" />
                </Row>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
