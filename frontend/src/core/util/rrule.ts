import { DateTime } from 'luxon';
import { ZONE } from './time';

export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly';

const FREQ_OUT: Record<Exclude<RepeatFreq, 'none'>, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
};

/** Build a **bounded** RRULE (spec §0 requires UNTIL/COUNT), or null when not repeating.
 *  `untilDate` is a Brisbane YYYY-MM-DD the series runs through, inclusive — we stamp
 *  UNTIL at end-of-day Brisbane in UTC so the final day's occurrence is always included,
 *  whatever the event's time-of-day. The server re-validates the string at the boundary. */
export function buildRRule(freq: RepeatFreq, untilDate: string): string | null {
  if (freq === 'none') return null;
  if (!untilDate) return null;
  const until = DateTime.fromISO(untilDate, { zone: ZONE }).endOf('day').toUTC();
  if (!until.isValid) return null;
  return `FREQ=${FREQ_OUT[freq]};UNTIL=${until.toFormat("yyyyLLdd'T'HHmmss'Z'")}`;
}

/** Inverse of buildRRule for populating the editor controls from a stored master. */
export function parseRRule(rrule: string | null): { freq: RepeatFreq; until: string } {
  if (!rrule) return { freq: 'none', until: '' };
  const freqM = /FREQ=(DAILY|WEEKLY|MONTHLY)/i.exec(rrule);
  const freq = (freqM ? (freqM[1].toLowerCase() as RepeatFreq) : 'none');
  const untilM = /UNTIL=(\d{8})(?:T(\d{6}))?Z?/i.exec(rrule);
  let until = '';
  if (untilM) {
    const parsed = DateTime.fromFormat(`${untilM[1]}${untilM[2] ?? '000000'}`, 'yyyyLLddHHmmss', {
      zone: 'utc',
    });
    if (parsed.isValid) until = parsed.setZone(ZONE).toFormat('yyyy-LL-dd');
  }
  return { freq, until };
}

export const REPEAT_LABELS: Record<RepeatFreq, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
