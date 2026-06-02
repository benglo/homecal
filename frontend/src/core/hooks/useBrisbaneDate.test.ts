import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { ZONE } from '../util/time';

/**
 * `useBrisbaneDate` is a React hook (uses useState/useEffect) so it can't be
 * rendered without a React testing environment, and this workspace doesn't
 * ship `@testing-library/react` + jsdom (existing tests are pure-logic unit
 * tests, see frontend/src/core/util/color.test.ts).
 *
 * Instead we test the same luxon expression the hook computes — that's the
 * load-bearing bit (the format string, the fixed zone). The `setTimeout`
 * re-scheduling at midnight is plumbing best covered by integration tests
 * with time-mocking, which would also require a React test renderer.
 */
describe('useBrisbaneDate (date-format logic)', () => {
  it('produces a YYYY-MM-DD string in the Brisbane zone', () => {
    const date = DateTime.now().setZone(ZONE).toFormat('yyyy-LL-dd');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses the fixed Australia/Brisbane zone (UTC+10, no DST)', () => {
    // A known UTC instant (midnight UTC) must show as 10:00 in Brisbane,
    // and the calendar day must roll over as expected — proves we're not
    // accidentally using the system zone.
    const utcMidnight = DateTime.fromISO('2026-06-02T00:00:00Z', { zone: 'utc' });
    const bne = utcMidnight.setZone(ZONE);
    expect(bne.toFormat('yyyy-LL-dd')).toBe('2026-06-02');
    expect(bne.toFormat('HH:mm')).toBe('10:00');
    expect(bne.offset).toBe(600); // +10:00 in minutes, year-round
  });

  it('rolls over at Brisbane midnight, not UTC midnight', () => {
    // 23:30 UTC on 2026-06-01 is 09:30 the next day in Brisbane.
    const lateUtc = DateTime.fromISO('2026-06-01T23:30:00Z', { zone: 'utc' });
    expect(lateUtc.setZone(ZONE).toFormat('yyyy-LL-dd')).toBe('2026-06-02');
  });

  it('msUntilBrisbaneMidnight-style math is non-negative and < 24h', () => {
    const now = DateTime.now().setZone(ZONE);
    const nextMidnight = now.plus({ days: 1 }).startOf('day');
    const ms = nextMidnight.toMillis() - now.toMillis();
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
