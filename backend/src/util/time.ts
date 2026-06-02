/**
 * Time helpers. Storage convention (spec §0): TEXT, ISO-8601, UTC, fixed-width,
 * `Z`-suffixed, second precision. Brisbane is fixed UTC+10 (no DST), so naive
 * UTC recurrence is correct; we never tz-convert in storage.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Format a Date as 'YYYY-MM-DDTHH:MM:SSZ' (drop milliseconds). */
export function isoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Current UTC instant in storage format. Used for `created_at`/`updated_at`. */
export const nowIso = (): string => isoUtc(new Date());

/**
 * Normalize an incoming timestamp to the storage convention.
 * - all-day accepts a bare 'YYYY-MM-DD' (anchored at midnight UTC) or an instant.
 * - timed requires a parseable instant.
 * Throws on unparseable input (caller maps to a 400).
 */
export function normalizeTimestamp(input: string, allDay: boolean): string {
  if (allDay && DATE_ONLY.test(input)) return `${input}T00:00:00Z`;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid timestamp: ${input}`);
  }
  return isoUtc(d);
}

/** The date portion (YYYY-MM-DD, UTC) of an ISO instant — used for dinners/all-day. */
export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export const DAY_MS = 86_400_000;

/** Fixed-offset Brisbane timezone (UTC+10, no DST — spec §0). */
export const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

/** Today's calendar date in Brisbane time, as 'YYYY-MM-DD'. */
export function todayBrisbane(now: Date = new Date()): string {
  return new Date(now.getTime() + BRISBANE_OFFSET_MS).toISOString().slice(0, 10);
}
