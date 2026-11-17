import test from 'node:test';
import assert from 'node:assert/strict';
import { maskIncludes, weekdayOf, WEEKDAYS, WEEKENDS, EVERY_DAY } from './days';

// 2026-11-15 is a Sunday, 11-16 Monday, 11-20 Friday, 11-21 Saturday.
test('weekdayOf matches strftime(%w) order (Sunday = 0)', () => {
  assert.equal(weekdayOf('2026-11-15'), 0);
  assert.equal(weekdayOf('2026-11-16'), 1);
  assert.equal(weekdayOf('2026-11-20'), 5);
  assert.equal(weekdayOf('2026-11-21'), 6);
});

test('WEEKDAYS covers Mon–Fri only', () => {
  assert.equal(maskIncludes(WEEKDAYS, '2026-11-15'), false);
  assert.equal(maskIncludes(WEEKDAYS, '2026-11-16'), true);
  assert.equal(maskIncludes(WEEKDAYS, '2026-11-20'), true);
  assert.equal(maskIncludes(WEEKDAYS, '2026-11-21'), false);
});

test('WEEKENDS and EVERY_DAY', () => {
  assert.equal(maskIncludes(WEEKENDS, '2026-11-15'), true);
  assert.equal(maskIncludes(WEEKENDS, '2026-11-16'), false);
  assert.equal(maskIncludes(EVERY_DAY, '2026-11-18'), true);
  assert.equal(maskIncludes(null, '2026-11-18'), true);
});
