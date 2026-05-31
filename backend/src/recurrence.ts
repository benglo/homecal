import { rrulestr } from 'rrule';
import { DAY_MS, isoUtc } from './util/time';
import type { EventException, EventMaster, EventOccurrence } from './model/types';

/** Hard cap on occurrences returned per master (guards against runaway rules). */
export const MAX_OCCURRENCES = 1000;

/**
 * Expand one master event into the occurrences overlapping [windowStart, windowEnd].
 *
 * - Non-recurring: 0 or 1 occurrence (if it overlaps the window).
 * - Recurring: RRULE expanded with `between`, widened by the event's duration so a
 *   long occurrence starting before the window is still included; `cancelled`
 *   exceptions (EXDATE) are dropped and `modified` exceptions overlaid.
 *
 * Brisbane is fixed UTC+10 (no DST): dtstart is read in UTC and occurrences are
 * emitted in UTC, so any constant offset cancels — no drift. (Documented assumption.)
 */
export function expandEvent(
  master: EventMaster,
  exceptions: EventException[],
  windowStartIso: string,
  windowEndIso: string
): EventOccurrence[] {
  const ws = Date.parse(windowStartIso);
  const we = Date.parse(windowEndIso);
  const startMs = Date.parse(master.start);
  const endMs = Date.parse(master.end);

  // All-day spans at least a full day so a zero-length all-day still overlaps.
  let duration = endMs - startMs;
  if (master.allDay && duration < DAY_MS) duration = DAY_MS;

  const overlaps = (s: number, e: number) => e > ws && s < we;

  if (!master.rrule) {
    if (!overlaps(startMs, startMs + duration)) return [];
    return [toOccurrence(master, startMs, startMs + duration, master.title, master.location, false)];
  }

  const exByDate = new Map(exceptions.map((e) => [e.occurrenceDate, e]));

  // Defensive: a stored rule is validated on write, but a manual DB edit, a migration,
  // or an rrule upgrade could yield a string that parses on write yet throws on expand.
  // Degrade to "this one series is missing", never "the whole window 500s and the wall
  // blanks". listOccurrences also catches per-master as a second layer.
  let occDates: Date[];
  try {
    const rule = rrulestr(master.rrule, { dtstart: new Date(master.start) });
    // Widen the lower bound by the duration to catch occurrences straddling windowStart.
    occDates = rule.between(new Date(ws - duration), new Date(we), true);
  } catch {
    return [];
  }

  const out: EventOccurrence[] = [];
  for (const occDate of occDates) {
    if (out.length >= MAX_OCCURRENCES) break;

    const occIso = isoUtc(occDate);
    const ex = exByDate.get(occIso);
    if (ex?.kind === 'cancelled') continue;

    let s = occDate.getTime();
    let title = master.title;
    let location = master.location;
    if (ex?.kind === 'modified') {
      if (ex.start) s = Date.parse(ex.start);
      if (ex.title != null) title = ex.title;
      if (ex.location !== null) location = ex.location;
    }
    const e = ex?.kind === 'modified' && ex.end ? Date.parse(ex.end) : s + duration;

    if (!overlaps(s, e)) continue;
    out.push(toOccurrence(master, s, e, title, location, true, occIso));
  }
  return out;
}

function toOccurrence(
  master: EventMaster,
  startMs: number,
  endMs: number,
  title: string,
  location: string | null,
  isRecurring: boolean,
  occurrenceIso?: string
): EventOccurrence {
  const occ: EventOccurrence = {
    id: occurrenceIso ? `${master.id}:${occurrenceIso}` : master.id,
    masterId: master.id,
    categoryId: master.categoryId,
    title,
    start: isoUtc(new Date(startMs)),
    end: isoUtc(new Date(endMs)),
    allDay: master.allDay,
    isRecurring,
  };
  if (location != null) occ.location = location;
  if (occurrenceIso) occ.occurrenceDate = occurrenceIso;
  return occ;
}
