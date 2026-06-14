import { DateTime } from 'luxon';
import { nextHalfHour, ZONE } from '../../core/util/time';

/** Prefill produced by tapping/dragging a calendar slot (all values Brisbane-local). */
export interface SlotSelection {
  date: string; // yyyy-LL-dd
  time?: string; // HH:mm — absent for all-day
  endTime?: string; // HH:mm
  endDate?: string; // yyyy-LL-dd — multi-day all-day ranges only
  allDay: boolean;
}

/** The subset of FullCalendar's DateSelectArg we consume (keeps tests FC-free). */
export interface FcSelectLike {
  start: Date;
  end: Date;
  allDay: boolean;
}

const DRAFT_MINUTES = 60;

/** FC selection → Quick Add prefill. Bare timeGrid taps select one 30-min slot,
 *  so anything shorter than the 1h draft is widened; real drags keep their range.
 *  dayGrid single-day taps become timed drafts (all-day is one toggle away). */
export function mapSlotSelection(sel: FcSelectLike, now: DateTime): SlotSelection {
  const start = DateTime.fromJSDate(sel.start).setZone(ZONE);
  const end = DateTime.fromJSDate(sel.end).setZone(ZONE);

  if (!sel.allDay) {
    const minutes = end.diff(start, 'minutes').minutes;
    const finalEnd = minutes < DRAFT_MINUTES ? start.plus({ minutes: DRAFT_MINUTES }) : end;
    return {
      date: start.toFormat('yyyy-LL-dd'),
      time: start.toFormat('HH:mm'),
      endTime: finalEnd.toFormat('HH:mm'),
      allDay: false,
    };
  }

  const lastDay = end.minus({ days: 1 }); // FC all-day end is exclusive
  if (!start.hasSame(lastDay, 'day')) {
    return { date: start.toFormat('yyyy-LL-dd'), endDate: lastDay.toFormat('yyyy-LL-dd'), allDay: true };
  }
  const t = nextHalfHour(now.setZone(ZONE));
  return {
    date: start.toFormat('yyyy-LL-dd'),
    time: t.toFormat('HH:mm'),
    endTime: t.plus({ hours: 1 }).toFormat('HH:mm'),
    allDay: false,
  };
}

/** A single tap/click on a slot (FC `dateClick`). On touch a plain tap fires
 *  `dateClick`, NOT `select` (which needs a long-press drag) — so without this
 *  a tap creates nothing on the kiosk. timeGrid taps give a timed point →
 *  widened to a 1h draft; dayGrid taps give an all-day point → a timed draft at
 *  the next half-hour (synthesised as a single-day range so the month branch of
 *  mapSlotSelection fires, not the multi-day one). */
export function mapDateClick(arg: { date: Date; allDay: boolean }, now: DateTime): SlotSelection {
  const start = arg.date;
  // dayGrid all-day end is exclusive; +1 day makes mapSlotSelection treat it as
  // a single-day tap rather than an inverted multi-day range.
  const end = arg.allDay ? new Date(start.getTime() + 86_400_000) : start;
  return mapSlotSelection({ start, end, allDay: arg.allDay }, now);
}

/** Prefill for slot-less entry points (ControlBar +, phone FAB). */
export function defaultSlot(now: DateTime): SlotSelection {
  const t = nextHalfHour(now.setZone(ZONE));
  return {
    date: now.setZone(ZONE).toFormat('yyyy-LL-dd'),
    time: t.toFormat('HH:mm'),
    endTime: t.plus({ hours: 1 }).toFormat('HH:mm'),
    allDay: false,
  };
}
