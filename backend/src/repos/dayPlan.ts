import { getDb } from '../db';
import { isoUtc, BRISBANE_OFFSET_MS, DAY_MS } from '../util/time';
import { maskIncludes } from '../util/days';
import { getBoard } from './chores';
import { listRoutines } from './routines';
import { latestDinnerCall } from './dinnerCalls';
import { getRoutineSettings } from './routineSettings';
import type { DayPlan, DayPlanMember, DayPlanRoutine } from '../model/types';

/** Brisbane wall-clock 'HH:MM' on `date` → UTC instant (fixed UTC+10, spec §0). */
export function brisbaneInstant(date: string, time: string): string {
  return isoUtc(new Date(Date.parse(`${date}T${time}:00Z`) - BRISBANE_OFFSET_MS));
}

/**
 * One read for glanceable clients (the TV launcher): who's in the family, each
 * person's routine checklists due today, today's routine instants, dinner, and
 * the latest "dinner's ready" call. Reuses the chore board so "due today" has
 * exactly one definition.
 */
export function getDayPlan(date: string): DayPlan {
  const board = getBoard(date);
  const members: DayPlanMember[] = board.members.map((m) => {
    const pick = (routine: 'morning' | 'bedtime') =>
      m.chores
        .filter((c) => c.routine === routine)
        .map((c) => ({ id: c.id, title: c.title, icon: c.icon, stars: c.stars, done: c.completed }));
    return {
      id: m.id,
      name: m.name,
      icon: m.icon,
      checklists: { morning: pick('morning'), bedtime: pick('bedtime') },
    };
  });

  const routines: DayPlanRoutine[] = listRoutines()
    .filter((r) => maskIncludes(r.days, date))
    .map((r) => ({ id: r.id, kind: r.kind, at: brisbaneInstant(date, r.time), memberId: r.memberId }))
    .sort((a, b) => a.at.localeCompare(b.at));

  const dinnerRow = getDb().prepare('SELECT meal FROM dinners WHERE date = ?').get(date) as
    | { meal: string }
    | undefined;

  const dayStart = brisbaneInstant(date, '00:00');
  const dayEnd = isoUtc(new Date(Date.parse(dayStart) + DAY_MS));

  const settings = getRoutineSettings();
  return {
    date,
    members,
    routines,
    dinner: dinnerRow ? { meal: dinnerRow.meal } : null,
    dinnerCall: latestDinnerCall(dayStart, dayEnd),
    settings,
    morningsOff: settings.morningsOffUntil != null && date <= settings.morningsOffUntil,
  };
}
