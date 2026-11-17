import { getDb } from '../db';
import { nowIso } from '../util/time';
import type { RoutineSettings } from '../model/types';
import type { RoutineSettingsUpdate } from '../schemas';

interface Row {
  warn_minutes: number;
  grace_minutes: number;
  morning_window_minutes: number;
  night_end: string;
  bath_locks: number;
  dinner_reminder: number;
  mornings_off_until: string | null;
  updated_at: string;
}

const toSettings = (r: Row): RoutineSettings => ({
  warnMinutes: r.warn_minutes,
  graceMinutes: r.grace_minutes,
  morningWindowMinutes: r.morning_window_minutes,
  nightEnd: r.night_end,
  bathLocks: r.bath_locks === 1,
  dinnerReminder: r.dinner_reminder === 1,
  morningsOffUntil: r.mornings_off_until,
  updatedAt: r.updated_at,
});

/** The v9 migration seeds row 1, so this always exists. */
export function getRoutineSettings(): RoutineSettings {
  return toSettings(getDb().prepare('SELECT * FROM routine_settings WHERE id = 1').get() as Row);
}

export function updateRoutineSettings(patch: RoutineSettingsUpdate): RoutineSettings {
  const next = { ...getRoutineSettings(), ...patch };
  getDb()
    .prepare(
      `UPDATE routine_settings SET warn_minutes=?, grace_minutes=?, morning_window_minutes=?, night_end=?,
         bath_locks=?, dinner_reminder=?, mornings_off_until=?, updated_at=? WHERE id = 1`
    )
    .run(
      next.warnMinutes,
      next.graceMinutes,
      next.morningWindowMinutes,
      next.nightEnd,
      next.bathLocks ? 1 : 0,
      next.dinnerReminder ? 1 : 0,
      next.morningsOffUntil ?? null,
      nowIso()
    );
  return getRoutineSettings();
}
