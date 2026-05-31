import { DateTime } from 'luxon';
import type { Category, EventOccurrence } from '../../core/model/types';
import { dayKey, ZONE } from '../../core/util/time';
import { EventRow } from '../primitives/EventRow';

interface Props {
  occurrences: EventOccurrence[];
  categories: Map<string, Category>;
  now: DateTime;
  onTap?: (occ: EventOccurrence) => void;
}

function headerFor(key: string, now: DateTime): { label: string; sub: string; accent: boolean } {
  const d = DateTime.fromISO(key, { zone: ZONE });
  const today = now.startOf('day');
  const diff = Math.round(d.startOf('day').diff(today, 'days').days);
  if (diff === 0) return { label: 'Today', sub: d.toFormat('cccc d LLLL'), accent: true };
  if (diff === 1) return { label: 'Tomorrow', sub: d.toFormat('cccc d LLLL'), accent: false };
  return { label: d.toFormat('cccc'), sub: d.toFormat('d LLLL'), accent: false };
}

/** Custom default wall view: grouped-by-day, full-width rows, distance-legible. */
export function AgendaView({ occurrences, categories, now, onTap }: Props) {
  const groups = new Map<string, EventOccurrence[]>();
  for (const occ of occurrences) {
    const k = dayKey(occ.start);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(occ);
  }
  const keys = [...groups.keys()].sort();

  if (keys.length === 0) {
    return (
      <div className="flex-1 grid place-items-center text-text-muted" style={{ fontSize: 28 }}>
        Nothing scheduled
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: '24px 36px 8px' }}>
      {keys.map((k) => {
        const h = headerFor(k, now);
        const rows = groups.get(k)!.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
        return (
          <section key={k}>
            <div className="flex items-baseline gap-3.5" style={{ margin: '18px 0 12px' }}>
              <span className="font-bold" style={{ fontSize: 24, letterSpacing: '-0.01em', color: h.accent ? 'var(--accent)' : 'var(--text)' }}>
                {h.label}
              </span>
              <span className="text-text-faint font-medium" style={{ fontSize: 18 }}>{h.sub}</span>
              <span className="flex-1 h-px bg-border" />
            </div>
            {rows.map((occ) => (
              <EventRow key={occ.id} occ={occ} category={categories.get(occ.categoryId)} onTap={onTap} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
