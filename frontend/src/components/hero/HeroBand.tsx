import type { DateTime } from 'luxon';
import { DateTime as DT } from 'luxon';
import { Utensils, Pencil, Plus } from 'lucide-react';
import type { Dinner, WeatherData } from '../../core/model/types';
import { ZONE } from '../../core/util/time';
import { Clock } from '../primitives/Clock';
import { StatusDot } from '../primitives/StatusDot';
import { WeatherSidebar } from '../weather/WeatherSidebar';

interface Props {
  now: DateTime;
  weekDays: string[]; // 7 YYYY-MM-DD (Mon..Sun)
  dinners: Dinner[];
  dataUpdatedAt: number;
  isError: boolean;
  weather?: WeatherData;
  /** Tap a day pill → open DinnerEditorSheet with that date pre-filled. */
  onTapDay: (date: string) => void;
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Hero band: Tonight dinner (rolls to tomorrow after 20:00) + week strip + clock.
 *  Day pills are buttons; empty cells show a corner +, filled cells a pencil. */
export function HeroBand({ now, weekDays, dinners, dataUpdatedAt, isError, weather, onTapDay }: Props) {
  const byDate = new Map(dinners.map((d) => [d.date, d.meal]));
  const todayKey = now.toFormat('yyyy-LL-dd');
  const rollToTomorrow = now.hour >= 20;
  const focusKey = rollToTomorrow ? now.plus({ days: 1 }).toFormat('yyyy-LL-dd') : todayKey;
  const focusMeal = byDate.get(focusKey);

  return (
    <div className="flex shrink-0 bg-surface border-b border-border" style={{ height: 200 }}>
      <div className="flex-1 flex flex-col justify-between" style={{ padding: '30px 36px' }}>
        <div>
          <div className="uppercase text-text-faint font-semibold" style={{ fontSize: 14, letterSpacing: '0.22em' }}>
            {rollToTomorrow ? 'Tomorrow' : 'Tonight'}
          </div>
          <div className="flex items-center gap-4 mt-2.5">
            <span
              className="grid place-items-center rounded-md shrink-0"
              style={{ width: 56, height: 56, background: 'color-mix(in srgb, var(--c-dinner) 16%, transparent)', color: 'var(--c-dinner)' }}
            >
              <Utensils size={30} />
            </span>
            <span className="font-bold leading-none" style={{ fontSize: 56, letterSpacing: '-0.02em' }}>
              {focusMeal ?? <span className="text-text-muted font-medium" style={{ fontSize: 38 }}>No dinner planned</span>}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2.5">
          {weekDays.map((date, i) => {
            const isToday = date === todayKey;
            const meal = byDate.get(date);
            const friendly = DT.fromISO(date, { zone: ZONE }).toFormat('cccc d LLLL');
            return (
              <button
                key={date}
                type="button"
                onClick={() => onTapDay(date)}
                aria-label={meal ? `Edit dinner for ${friendly}` : `Plan dinner for ${friendly}`}
                className="relative rounded-md border flex flex-col gap-1 text-left"
                style={{
                  padding: '9px 10px 11px',
                  paddingRight: 28,
                  minHeight: 64,
                  background: isToday ? 'var(--accent-weak)' : 'var(--surface-2)',
                  borderColor: isToday ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)',
                }}
              >
                <div className="uppercase font-bold flex items-center gap-1.5" style={{ fontSize: 13, letterSpacing: '0.08em', color: isToday ? 'var(--accent)' : 'var(--text-faint)' }}>
                  {isToday && <span style={{ color: 'var(--accent)' }}>★</span>}
                  {WEEKDAY[i]}
                </div>
                <div className="leading-tight" style={{ fontSize: 18, color: meal ? 'var(--text)' : 'var(--text-faint)' }}>
                  {meal ?? '—'}
                </div>
                <span
                  aria-hidden
                  className="absolute"
                  style={{ top: 8, right: 8, color: 'var(--text-faint)', opacity: 0.75 }}
                >
                  {meal ? <Pencil size={18} /> : <Plus size={20} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-l border-border flex flex-col items-end justify-between" style={{ width: 340, padding: '24px 36px' }}>
        <Clock now={now} />
        <WeatherSidebar weather={weather} isNight={now.hour < 6 || now.hour >= 20} />
        <StatusDot dataUpdatedAt={dataUpdatedAt} isError={isError} />
      </div>
    </div>
  );
}
