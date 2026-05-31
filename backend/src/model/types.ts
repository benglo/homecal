/** Domain + API types. Mirror spec §6. */

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  updatedAt: string;
}

/** The stored master event (un-expanded). Returned by GET /api/events/:id. */
export interface EventMaster {
  id: string;
  categoryId: string;
  title: string;
  start: string; // ISO-8601 UTC; DTSTART for recurring
  end: string; // ISO-8601 UTC (stored as end_at)
  allDay: boolean;
  location: string | null;
  rrule: string | null;
  updatedAt: string;
}

export type ExceptionKind = 'cancelled' | 'modified';

export interface EventException {
  occurrenceDate: string; // original occurrence start, ISO-8601 UTC
  kind: ExceptionKind;
  title: string | null;
  start: string | null;
  end: string | null;
  location: string | null;
}

/** A single expanded occurrence — what GET /api/events returns. */
export interface EventOccurrence {
  id: string; // "masterId:occurrenceISO" for recurring; masterId for single
  masterId: string;
  categoryId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  isRecurring: boolean;
  occurrenceDate?: string; // original occurrence start (for cancel/override)
}

export interface Dinner {
  date: string; // YYYY-MM-DD
  meal: string;
  updatedAt: string;
}
