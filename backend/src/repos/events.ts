import { getDb } from '../db';
import { newId } from '../util/ids';
import { isoUtc, normalizeTimestamp } from '../util/time';
import { httpError } from '../util/errors';
import { expandEvent, MAX_OCCURRENCES } from '../recurrence';
import { categoryExists } from './categories';
import type { EventException, EventMaster, EventOccurrence } from '../model/types';
import type { EventCreate, EventUpdate } from '../schemas';

interface MasterRow {
  id: string;
  category_id: string;
  title: string;
  start: string;
  end_at: string;
  all_day: number;
  location: string | null;
  rrule: string | null;
  updated_at: string;
}
const toMaster = (r: MasterRow): EventMaster => ({
  id: r.id,
  categoryId: r.category_id,
  title: r.title,
  start: r.start,
  end: r.end_at,
  allDay: !!r.all_day,
  location: r.location,
  rrule: r.rrule,
  updatedAt: r.updated_at,
});

interface ExRow {
  occurrence_date: string;
  kind: 'cancelled' | 'modified';
  title: string | null;
  start: string | null;
  end_at: string | null;
  location: string | null;
}
const toException = (r: ExRow): EventException => ({
  occurrenceDate: r.occurrence_date,
  kind: r.kind,
  title: r.title,
  start: r.start,
  end: r.end_at,
  location: r.location,
});

const now = () => isoUtc(new Date());

export function getEventMaster(id: string): EventMaster | null {
  const r = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as MasterRow | undefined;
  return r ? toMaster(r) : null;
}

function exceptionsFor(eventId: string): EventException[] {
  return (
    getDb().prepare('SELECT * FROM event_exceptions WHERE event_id = ?').all(eventId) as ExRow[]
  ).map(toException);
}

/** Expanded occurrences overlapping [start,end]: non-recurring via index + recurring masters expanded. */
export function listOccurrences(startIso: string, endIso: string): EventOccurrence[] {
  const db = getDb();
  const out: EventOccurrence[] = [];

  const nonRecurring = db
    .prepare('SELECT * FROM events WHERE rrule IS NULL AND start <= ? AND end_at >= ?')
    .all(endIso, startIso) as MasterRow[];
  for (const r of nonRecurring) out.push(...expandEvent(toMaster(r), [], startIso, endIso));

  const recurring = db.prepare('SELECT * FROM events WHERE rrule IS NOT NULL').all() as MasterRow[];
  for (const r of recurring) {
    if (out.length >= MAX_OCCURRENCES * 4) break;
    // Second layer behind expandEvent's own guard: one unexpandable master must never
    // take down the whole window. Skip it; the rest of the calendar still renders.
    try {
      out.push(...expandEvent(toMaster(r), exceptionsFor(r.id), startIso, endIso));
    } catch {
      /* skip a single bad series rather than blank the wall */
    }
  }

  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

export function createEvent(input: EventCreate): EventMaster {
  const db = getDb();
  if (!categoryExists(db, input.categoryId)) {
    throw httpError(400, 'INVALID_CATEGORY', 'categoryId does not exist');
  }
  const id = newId();
  const ts = now();
  const start = normalizeTimestamp(input.start, input.allDay);
  const end = normalizeTimestamp(input.end, input.allDay);
  db.prepare(
    `INSERT INTO events (id, category_id, title, start, end_at, all_day, location, rrule, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.categoryId, input.title, start, end, input.allDay ? 1 : 0, input.location ?? null, input.rrule ?? null, ts, ts);
  return getEventMaster(id)!;
}

export function updateEvent(id: string, patch: EventUpdate): EventMaster {
  const db = getDb();
  const cur = getEventMaster(id);
  if (!cur) throw httpError(404, 'NOT_FOUND', 'Event not found');
  if (patch.categoryId && !categoryExists(db, patch.categoryId)) {
    throw httpError(400, 'INVALID_CATEGORY', 'categoryId does not exist');
  }
  const allDay = patch.allDay ?? cur.allDay;
  const next = {
    categoryId: patch.categoryId ?? cur.categoryId,
    title: patch.title ?? cur.title,
    start: patch.start ? normalizeTimestamp(patch.start, allDay) : cur.start,
    end: patch.end ? normalizeTimestamp(patch.end, allDay) : cur.end,
    allDay,
    location: patch.location !== undefined ? patch.location : cur.location,
    rrule: patch.rrule !== undefined ? patch.rrule : cur.rrule,
  };
  if (Date.parse(next.end) < Date.parse(next.start)) {
    throw httpError(400, 'BAD_REQUEST', 'end must be >= start');
  }
  db.prepare(
    `UPDATE events SET category_id=?, title=?, start=?, end_at=?, all_day=?, location=?, rrule=?, updated_at=? WHERE id=?`
  ).run(next.categoryId, next.title, next.start, next.end, next.allDay ? 1 : 0, next.location, next.rrule, now(), id);
  return getEventMaster(id)!;
}

export function deleteEvent(id: string): void {
  const db = getDb();
  if (!getEventMaster(id)) throw httpError(404, 'NOT_FOUND', 'Event not found');
  db.prepare('DELETE FROM events WHERE id = ?').run(id); // exceptions cascade
}

/** Cancel a single occurrence of a recurring event (EXDATE). */
export function cancelOccurrence(eventId: string, occurrenceDate: string): void {
  const db = getDb();
  const master = getEventMaster(eventId);
  if (!master) throw httpError(404, 'NOT_FOUND', 'Event not found');
  if (!master.rrule) throw httpError(400, 'NOT_RECURRING', 'Event is not recurring');
  const occIso = normalizeTimestamp(occurrenceDate, master.allDay);
  db.prepare(
    `INSERT INTO event_exceptions (event_id, occurrence_date, kind)
     VALUES (?, ?, 'cancelled')
     ON CONFLICT(event_id, occurrence_date) DO UPDATE SET kind='cancelled',
       title=NULL, start=NULL, end_at=NULL, location=NULL`
  ).run(eventId, occIso);
}
