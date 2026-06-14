import { describe, it, expect } from 'vitest';
import { buildQuickAddPayload } from './quickAddPayload';

const base = {
  categoryId: 'cat-family',
  title: 'Soccer practice',
  date: '2026-06-11',
  time: '14:00',
  endTime: '16:00',
  allDay: false,
};

describe('buildQuickAddPayload', () => {
  it('timed event → UTC ISO start/end (Brisbane is UTC+10)', () => {
    expect(buildQuickAddPayload(base)).toEqual({
      categoryId: 'cat-family',
      title: 'Soccer practice',
      start: '2026-06-11T04:00:00Z',
      end: '2026-06-11T06:00:00Z',
      allDay: false,
    });
  });

  it('trims the title', () => {
    expect(buildQuickAddPayload({ ...base, title: '  Soccer  ' })?.title).toBe('Soccer');
  });

  it('end at/before start rolls end to the next day (23:30 → 00:30)', () => {
    const p = buildQuickAddPayload({ ...base, time: '23:30', endTime: '00:30' });
    expect(p?.start).toBe('2026-06-11T13:30:00Z');
    expect(p?.end).toBe('2026-06-11T14:30:00Z'); // 00:30 on 12 Jun Brisbane
  });

  it('all-day single date → bare dates', () => {
    expect(buildQuickAddPayload({ ...base, allDay: true })).toEqual({
      categoryId: 'cat-family',
      title: 'Soccer practice',
      start: '2026-06-11',
      end: '2026-06-11',
      allDay: true,
    });
  });

  it('all-day multi-day range uses endDate', () => {
    expect(buildQuickAddPayload({ ...base, allDay: true, endDate: '2026-06-13' })?.end).toBe('2026-06-13');
  });

  it('returns null without a title or category', () => {
    expect(buildQuickAddPayload({ ...base, title: '   ' })).toBeNull();
    expect(buildQuickAddPayload({ ...base, categoryId: '' })).toBeNull();
  });
});
