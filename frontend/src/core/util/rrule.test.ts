import { describe, it, expect } from 'vitest';
import { buildRRule, parseRRule } from './rrule';

describe('buildRRule', () => {
  it('returns null when not repeating or no end date', () => {
    expect(buildRRule('none', '2026-12-31')).toBeNull();
    expect(buildRRule('weekly', '')).toBeNull();
  });

  it('builds a bounded rule (spec §0 requires UNTIL/COUNT)', () => {
    const r = buildRRule('weekly', '2026-08-31');
    expect(r).toMatch(/^FREQ=WEEKLY;UNTIL=\d{8}T\d{6}Z$/);
    expect(r).toContain('UNTIL='); // bounded
  });

  it('stamps UNTIL at end-of-day Brisbane in UTC (13:59:59Z = 23:59:59 +10)', () => {
    // 2026-08-31 23:59:59 Brisbane (UTC+10) → 2026-08-31 13:59:59 UTC
    expect(buildRRule('daily', '2026-08-31')).toBe('FREQ=DAILY;UNTIL=20260831T135959Z');
  });
});

describe('parseRRule', () => {
  it('round-trips with buildRRule', () => {
    const built = buildRRule('monthly', '2026-10-15')!;
    expect(parseRRule(built)).toEqual({ freq: 'monthly', until: '2026-10-15' });
  });

  it('returns none for a null rule', () => {
    expect(parseRRule(null)).toEqual({ freq: 'none', until: '' });
  });

  it('reads a date-only UNTIL back to the Brisbane calendar day', () => {
    expect(parseRRule('FREQ=WEEKLY;UNTIL=20260831T135959Z').until).toBe('2026-08-31');
  });
});
