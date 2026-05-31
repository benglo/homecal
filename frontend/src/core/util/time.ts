import { DateTime } from 'luxon';
import type { WallView } from '../model/types';

export const ZONE = 'Australia/Brisbane';

export const nowBne = (): DateTime => DateTime.now().setZone(ZONE);

export const toBne = (iso: string): DateTime => DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE);

/** 'HH:mm' time, or 'All day'. */
export function fmtTime(iso: string, allDay: boolean): string {
  if (allDay) return 'All day';
  return toBne(iso).toFormat('HH:mm');
}

/** Local (Brisbane) calendar-day key for grouping/grid placement. */
export const dayKey = (iso: string): string => toBne(iso).toFormat('yyyy-LL-dd');

export interface Window {
  startIso: string; // UTC ISO for the API
  endIso: string;
}

/** Event window for a given view + anchor date (Brisbane), returned as UTC ISO. */
export function eventWindow(view: WallView, anchor: DateTime, agendaDays = 10): Window {
  const a = anchor.setZone(ZONE);
  let start: DateTime;
  let end: DateTime;
  if (view === 'agenda') {
    start = a.startOf('day');
    end = start.plus({ days: agendaDays });
  } else if (view === 'week') {
    start = a.startOf('week'); // luxon week starts Monday
    end = start.plus({ weeks: 1 });
  } else {
    const first = a.startOf('month');
    start = first.startOf('week');
    end = start.plus({ days: 42 });
  }
  return { startIso: start.toUTC().toISO()!, endIso: end.toUTC().toISO()! };
}

/** The current Brisbane week as YYYY-MM-DD date strings (Mon..Sun) for dinners. */
export function weekDates(anchor: DateTime): { start: string; end: string; days: string[] } {
  const mon = anchor.setZone(ZONE).startOf('week');
  const days = Array.from({ length: 7 }, (_, i) => mon.plus({ days: i }).toFormat('yyyy-LL-dd'));
  return { start: days[0], end: days[6], days };
}
