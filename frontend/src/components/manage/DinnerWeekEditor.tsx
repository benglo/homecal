import { DateTime } from 'luxon';
import { ChevronRight } from 'lucide-react';
import type { Dinner } from '../../core/model/types';
import { ZONE } from '../../core/util/time';

interface Props {
  weekDays: string[]; // yyyy-MM-dd ×7
  dinners: Dinner[];
  today: string;
  onTapDay: (date: string, currentMeal: string) => void;
}

/** Manage-tab week of meals; tap a day → DinnerEditorSheet. Mirrors WeekMealStrip. */
export function DinnerWeekEditor({ weekDays, dinners, today, onTapDay }: Props) {
  const byDate = new Map(dinners.map((d) => [d.date, d.meal]));

  return (
    <section style={{ marginBottom: 24 }}>
      <h2 className="font-semibold text-text-muted" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        This week's dinners
      </h2>
      <ul className="flex flex-col gap-2">
        {weekDays.map((date) => {
          const meal = byDate.get(date) ?? '';
          const d = DateTime.fromISO(date, { zone: ZONE });
          const isToday = date === today;
          return (
            <li key={date}>
              <button
                type="button"
                onClick={() => onTapDay(date, meal)}
                className="flex items-center gap-3 w-full text-left rounded-md border"
                style={{
                  padding: '12px 14px',
                  background: isToday ? 'var(--accent-weak)' : 'var(--surface)',
                  borderColor: isToday ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <span className="shrink-0 font-semibold" style={{ width: 44, fontSize: 14, color: isToday ? 'var(--accent-ink)' : 'var(--text)' }}>
                  {d.toFormat('ccc')}
                  {isToday && ' ★'}
                </span>
                <span className="flex-1 min-w-0 truncate" style={{ fontSize: 15, color: meal ? 'var(--text)' : 'var(--text-faint)' }}>
                  {meal || 'No dinner planned'}
                </span>
                <ChevronRight size={18} className="text-text-faint shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
