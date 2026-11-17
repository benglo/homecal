/**
 * Weekday bitmasks. Bit order matches SQLite `strftime('%w')` and JS `getUTCDay()`
 * (bit 0 = Sunday … bit 6 = Saturday) so SQL filters and app code agree.
 */
export const EVERY_DAY = 127;
export const WEEKDAYS = 62; // Mon–Fri
export const WEEKENDS = 65; // Sat + Sun

/** Day of week (0 = Sunday) for a 'YYYY-MM-DD' calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** True when `mask` includes the weekday of `date`. A null mask means every day. */
export function maskIncludes(mask: number | null, date: string): boolean {
  if (mask == null) return true;
  return ((mask >> weekdayOf(date)) & 1) === 1;
}
