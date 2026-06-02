import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ZONE } from '../../core/util/time';

interface Props {
  /** ISO start-of-week (Mon) in Brisbane, as yyyy-LL-dd. */
  weekStart: string;
  /** Currently selected yyyy-LL-dd. */
  selected: string;
  /** Map yyyy-LL-dd → meal (truthy = planned). */
  plannedByDate: Map<string, string>;
  /** yyyy-LL-dd of today in Brisbane (for the highlight). */
  today: string;
  onSelectDate: (date: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Mini week strip used at the top of DinnerEditorSheet. Mon–Sun pills (≥72px),
 *  64px chevrons step ±1 week. Selected pill is filled; today gets a ★. */
export function DinnerDateStrip({
  weekStart,
  selected,
  plannedByDate,
  today,
  onSelectDate,
  onPrevWeek,
  onNextWeek,
}: Props) {
  const monday = DateTime.fromISO(weekStart, { zone: ZONE });
  const days = Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }));
  const rangeLabel = `${days[0].toFormat('d LLL')} – ${days[6].toFormat('d LLL')}`;

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={onPrevWeek}
          aria-label="Previous week"
          className="grid place-items-center rounded-full text-text-muted"
          style={{ width: 64, height: 64, background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <ChevronLeft size={28} />
        </button>
        <span className="font-semibold text-text-muted" style={{ fontSize: 15, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {rangeLabel}
        </span>
        <button
          type="button"
          onClick={onNextWeek}
          aria-label="Next week"
          className="grid place-items-center rounded-full text-text-muted"
          style={{ width: 64, height: 64, background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <ChevronRight size={28} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((d, i) => {
          const date = d.toFormat('yyyy-LL-dd');
          const isSelected = date === selected;
          const isToday = date === today;
          const planned = !!plannedByDate.get(date);
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              aria-pressed={isSelected}
              aria-label={d.toFormat('cccc d LLLL')}
              className="flex flex-col items-center justify-center rounded-md border"
              style={{
                minHeight: 72,
                background: isSelected
                  ? 'var(--accent)'
                  : isToday
                    ? 'var(--accent-weak)'
                    : 'var(--surface)',
                color: isSelected ? 'var(--accent-ink)' : 'var(--text)',
                borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 11, letterSpacing: 0.5, opacity: 0.85 }}>
                {WEEKDAY[i]}{isToday ? ' ★' : ''}
              </span>
              <span style={{ fontSize: 20 }}>{d.day}</span>
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  marginTop: 5,
                  background: planned ? (isSelected ? 'var(--accent-ink)' : 'var(--accent)') : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
