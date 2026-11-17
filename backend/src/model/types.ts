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

export interface DinnerSuggestion {
  meal: string;       // canonical casing = most recent usage (deterministic — see repo)
  count: number;      // total times used (case-insensitive)
  lastUsed: string;   // ISO UTC of the most recent updated_at
}

export interface FamilyMember {
  id: string;
  name: string;
  icon: string;
  updatedAt: string;
}

export type ChoreFrequency = 'daily' | 'weekly';
/** A chore tagged with a routine shows on that routine's checklist (e.g. the TV's morning gate). */
export type ChoreRoutine = 'morning' | 'bedtime';

export interface Chore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  frequency: ChoreFrequency;
  dayOfWeek: number | null;
  /** Weekday bitmask narrowing a daily chore (bit 0 = Sunday); null = every day. */
  days: number | null;
  routine: ChoreRoutine | null;
  assignedTo: string;
  position: number;
  updatedAt: string;
}

export interface ChoreCompletion {
  choreId: string;
  completedDate: string;
  completedAt: string;
}

export interface BoardChore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  completedAt: string | null;
  routine: ChoreRoutine | null;
}

export interface BoardMember {
  id: string;
  name: string;
  icon: string;
  totalStars: number;
  chores: BoardChore[];
}

export interface ChoreBoard {
  date: string;
  members: BoardMember[];
}

export type FamilyMemberCreate = { name: string; icon: string };

export interface Timer {
  id: string;
  label: string | null;
  durationSec: number;
  startedAt: string;
  expiresAt: string;
  acknowledgedAt: string | null;
  updatedAt: string;
}

export type RoutineKind = 'morning' | 'dinner' | 'bath' | 'bed';

/** A recurring household time. `time` is Brisbane wall-clock 'HH:MM'.
 *  'morning' = the time by which the morning checklist should be done. */
export interface Routine {
  id: string;
  kind: RoutineKind;
  time: string;
  days: number;
  memberId: string | null;
  updatedAt: string;
}

export interface DinnerCall {
  id: string;
  calledAt: string;
}

export interface DayPlanChore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  done: boolean;
}

export interface DayPlanMember {
  id: string;
  name: string;
  icon: string;
  checklists: Record<ChoreRoutine, DayPlanChore[]>;
}

export interface DayPlanRoutine {
  id: string;
  kind: RoutineKind;
  /** The routine's instant on this date, UTC ISO-8601. */
  at: string;
  memberId: string | null;
}

/** How the TV applies routines (singleton). */
export interface RoutineSettings {
  warnMinutes: number; // heads-up before dinner/bath/bed; 0 = none
  graceMinutes: number; // how long a show may run past bath/bed
  morningWindowMinutes: number; // morning gate opens this long before the "ready by" time
  nightEnd: string; // 'HH:MM': bedtime holds after midnight until this time
  bathLocks: boolean; // false = bath only reminds; bed still locks
  dinnerReminder: boolean; // scheduled reminder; the "Dinner's ready" call always works
  morningsOffUntil: string | null; // 'YYYY-MM-DD' inclusive: holidays, sick days
  updatedAt: string;
}

/** Everything a glanceable client (the TV launcher) needs for one day, in one read. */
export interface DayPlan {
  date: string;
  members: DayPlanMember[];
  routines: DayPlanRoutine[];
  dinner: { meal: string } | null;
  dinnerCall: DinnerCall | null;
  settings: RoutineSettings;
  /** True when the morning checklist is switched off for this date (morningsOffUntil). */
  morningsOff: boolean;
}
