import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandEvent, MAX_OCCURRENCES } from './recurrence';
import type { EventException, EventMaster } from './model/types';

/** The (rrule, window) -> occurrences truth-table the spec (M1) requires. */

function master(overrides: Partial<EventMaster>): EventMaster {
  return {
    id: 'm1',
    categoryId: 'cat-sport',
    title: 'Swimming',
    start: '2026-06-01T06:00:00Z',
    end: '2026-06-01T07:00:00Z',
    allDay: false,
    location: null,
    rrule: null,
    updatedAt: '2026-05-31T00:00:00Z',
    ...overrides,
  };
}

const starts = (occ: { start: string }[]) => occ.map((o) => o.start);

test('a malformed stored RRULE is skipped, not thrown (never blanks the wall)', () => {
  const m = master({ rrule: 'this is not a valid rrule' });
  let result: { start: string }[] = [];
  assert.doesNotThrow(() => {
    result = expandEvent(m, [], '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z');
  });
  assert.deepEqual(result, []);
});

test('non-recurring: included only when it overlaps the window', () => {
  const m = master({ start: '2026-06-10T02:00:00Z', end: '2026-06-10T03:00:00Z' });
  assert.equal(expandEvent(m, [], '2026-06-09T00:00:00Z', '2026-06-11T00:00:00Z').length, 1);
  assert.equal(expandEvent(m, [], '2026-06-12T00:00:00Z', '2026-06-15T00:00:00Z').length, 0);
});

test('non-recurring single occurrence carries the master id (not synthetic)', () => {
  const m = master({ id: 'abc', start: '2026-06-10T02:00:00Z', end: '2026-06-10T03:00:00Z' });
  const [occ] = expandEvent(m, [], '2026-06-09T00:00:00Z', '2026-06-11T00:00:00Z');
  assert.equal(occ.id, 'abc');
  assert.equal(occ.isRecurring, false);
});

test('all-day weekly expands on date boundaries (no drift)', () => {
  const m = master({
    title: 'Bin night',
    start: '2026-06-01T00:00:00Z',
    end: '2026-06-01T00:00:00Z',
    allDay: true,
    rrule: 'FREQ=WEEKLY;COUNT=4',
  });
  const occ = expandEvent(m, [], '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z');
  assert.deepEqual(starts(occ), [
    '2026-06-01T00:00:00Z',
    '2026-06-08T00:00:00Z',
    '2026-06-15T00:00:00Z',
    '2026-06-22T00:00:00Z',
  ]);
  assert.equal(occ.every((o) => o.allDay), true);
  assert.equal(occ[0].isRecurring, true);
  assert.equal(occ[0].occurrenceDate, '2026-06-01T00:00:00Z');
});

test('timed weekly expands across a month boundary', () => {
  const m = master({ start: '2026-05-27T06:00:00Z', end: '2026-05-27T07:00:00Z', rrule: 'FREQ=WEEKLY;UNTIL=20260715T000000Z' });
  const occ = expandEvent(m, [], '2026-05-25T00:00:00Z', '2026-06-30T00:00:00Z');
  assert.deepEqual(starts(occ), [
    '2026-05-27T06:00:00Z',
    '2026-06-03T06:00:00Z',
    '2026-06-10T06:00:00Z',
    '2026-06-17T06:00:00Z',
    '2026-06-24T06:00:00Z',
  ]);
});

test('cancelled exception (EXDATE) removes only that occurrence', () => {
  const m = master({ start: '2026-06-01T00:00:00Z', end: '2026-06-01T00:00:00Z', allDay: true, rrule: 'FREQ=WEEKLY;COUNT=4' });
  const ex: EventException[] = [
    { occurrenceDate: '2026-06-08T00:00:00Z', kind: 'cancelled', title: null, start: null, end: null, location: null },
  ];
  const occ = expandEvent(m, ex, '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z');
  assert.deepEqual(starts(occ), [
    '2026-06-01T00:00:00Z',
    '2026-06-15T00:00:00Z',
    '2026-06-22T00:00:00Z',
  ]);
});

test('modified exception overrides one occurrence (time + title)', () => {
  const m = master({ start: '2026-06-01T06:00:00Z', end: '2026-06-01T07:00:00Z', rrule: 'FREQ=WEEKLY;COUNT=3' });
  const ex: EventException[] = [
    {
      occurrenceDate: '2026-06-08T06:00:00Z',
      kind: 'modified',
      title: 'Swimming (late)',
      start: '2026-06-08T08:00:00Z',
      end: '2026-06-08T09:00:00Z',
      location: 'Pool 2',
    },
  ];
  const occ = expandEvent(m, ex, '2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z');
  const changed = occ.find((o) => o.occurrenceDate === '2026-06-08T06:00:00Z')!;
  assert.equal(changed.start, '2026-06-08T08:00:00Z');
  assert.equal(changed.title, 'Swimming (late)');
  assert.equal(changed.location, 'Pool 2');
});

test('window starting mid-series excludes earlier occurrences', () => {
  const m = master({ start: '2026-05-27T06:00:00Z', end: '2026-05-27T07:00:00Z', rrule: 'FREQ=WEEKLY;UNTIL=20260715T000000Z' });
  const occ = expandEvent(m, [], '2026-06-05T00:00:00Z', '2026-06-30T00:00:00Z');
  assert.deepEqual(starts(occ), [
    '2026-06-10T06:00:00Z',
    '2026-06-17T06:00:00Z',
    '2026-06-24T06:00:00Z',
  ]);
});

test('daily recurrence respects COUNT and window', () => {
  const m = master({ start: '2026-06-01T06:00:00Z', end: '2026-06-01T06:30:00Z', rrule: 'FREQ=DAILY;COUNT=10' });
  const occ = expandEvent(m, [], '2026-06-03T00:00:00Z', '2026-06-06T00:00:00Z');
  assert.deepEqual(starts(occ), [
    '2026-06-03T06:00:00Z',
    '2026-06-04T06:00:00Z',
    '2026-06-05T06:00:00Z',
  ]);
});

test('monthly recurrence', () => {
  const m = master({ start: '2026-01-15T03:00:00Z', end: '2026-01-15T04:00:00Z', rrule: 'FREQ=MONTHLY;COUNT=12' });
  const occ = expandEvent(m, [], '2026-03-01T00:00:00Z', '2026-05-31T00:00:00Z');
  assert.deepEqual(starts(occ), [
    '2026-03-15T03:00:00Z',
    '2026-04-15T03:00:00Z',
    '2026-05-15T03:00:00Z',
  ]);
});

test('occurrence count is capped', () => {
  const m = master({ start: '2020-01-01T00:00:00Z', end: '2020-01-01T00:30:00Z', rrule: 'FREQ=DAILY;COUNT=5000' });
  const occ = expandEvent(m, [], '2020-01-01T00:00:00Z', '2040-01-01T00:00:00Z');
  assert.ok(occ.length <= MAX_OCCURRENCES);
});
