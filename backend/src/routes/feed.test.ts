import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed } from './feed';
import type { Category, EventMaster, Dinner } from '../model/types';
import type { CancelledEx } from '../repos/events';

/* ── helpers ─────────────────────────────────────────────────── */

const cat: Category = {
  id: 'cat-1',
  name: 'Work',
  color: '#0072B2',
  icon: 'briefcase',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeMaster(overrides: Partial<EventMaster> = {}): EventMaster {
  return {
    id: 'evt-1',
    categoryId: 'cat-1',
    title: 'Standup',
    start: '2026-06-10T10:00:00Z',
    end: '2026-06-10T10:30:00Z',
    allDay: false,
    location: 'Room A',
    rrule: null,
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

/* ── tests ───────────────────────────────────────────────────── */

test('empty calendar → valid VCALENDAR with no VEVENT', () => {
  const ics = buildFeed([], [], [], []);
  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'missing VCALENDAR begin');
  assert.ok(ics.includes('END:VCALENDAR'), 'missing VCALENDAR end');
  assert.ok(!ics.includes('BEGIN:VEVENT'), 'should have no VEVENT');
  assert.ok(!ics.includes('END:VEVENT'), 'should have no VEVENT end');
});

test('single timed event → UID, DTSTART/DTEND UTC, SUMMARY, LOCATION, CATEGORIES', () => {
  const master = makeMaster();
  const ics = buildFeed([cat], [master], [], []);

  assert.ok(ics.includes('UID:evt-1@homecal'), 'UID mismatch');
  // Timed events: UTC format YYYYMMDDTHHMMSSZ
  assert.ok(ics.includes('DTSTART:20260610T100000Z'), 'DTSTART mismatch');
  assert.ok(ics.includes('DTEND:20260610T103000Z'), 'DTEND mismatch');
  assert.ok(ics.includes('SUMMARY:Standup'), 'SUMMARY mismatch');
  assert.ok(ics.includes('LOCATION:Room A'), 'LOCATION mismatch');
  assert.ok(ics.includes('CATEGORIES:Work'), 'CATEGORIES mismatch');
});

test('all-day event → VALUE=DATE format (YYYYMMDD), no LOCATION when null', () => {
  const master = makeMaster({
    id: 'evt-ad',
    start: '2026-06-15',
    end: '2026-06-16',
    allDay: true,
    location: null,
  });
  const ics = buildFeed([cat], [master], [], []);

  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260615'), 'DTSTART VALUE=DATE mismatch');
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260616'), 'DTEND VALUE=DATE mismatch');
  assert.ok(!ics.includes('LOCATION'), 'LOCATION should be absent when null');
});

test('recurring event → RRULE property present', () => {
  const master = makeMaster({
    id: 'evt-rec',
    rrule: 'FREQ=WEEKLY;UNTIL=20260801T000000Z',
  });
  const ics = buildFeed([cat], [master], [], []);

  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;UNTIL=20260801T000000Z'), 'RRULE mismatch');
});

test('cancelled exception → EXDATE present (datetime for timed events)', () => {
  const master = makeMaster({
    id: 'evt-rec',
    rrule: 'FREQ=WEEKLY;UNTIL=20260801T000000Z',
  });
  const exceptions: CancelledEx[] = [
    { eventId: 'evt-rec', occurrenceDate: '2026-07-15T10:00:00Z' },
  ];
  const ics = buildFeed([cat], [master], exceptions, []);

  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;UNTIL=20260801T000000Z'), 'RRULE mismatch');
  assert.ok(ics.includes('EXDATE:20260715T100000Z'), 'EXDATE mismatch');
});

test('all-day recurring with EXDATE → EXDATE;VALUE=DATE format', () => {
  const master = makeMaster({
    id: 'evt-adr',
    start: '2026-06-01',
    end: '2026-06-02',
    allDay: true,
    rrule: 'FREQ=WEEKLY;COUNT=10',
  });
  const exceptions: CancelledEx[] = [
    { eventId: 'evt-adr', occurrenceDate: '2026-06-15' },
  ];
  const ics = buildFeed([cat], [master], exceptions, []);

  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;COUNT=10'), 'RRULE mismatch');
  assert.ok(ics.includes('EXDATE;VALUE=DATE:20260615'), 'EXDATE;VALUE=DATE mismatch');
});

test('dinner → all-day VEVENT with Dinner summary, UID dinner-{date}@homecal, CATEGORIES:Dinner', () => {
  const dinner: Dinner = {
    date: '2026-06-10',
    meal: 'Spaghetti Bolognese',
    updatedAt: '2026-06-01T00:00:00Z',
  };
  const ics = buildFeed([], [], [], [dinner]);

  assert.ok(ics.includes('UID:dinner-2026-06-10@homecal'), 'UID mismatch');
  assert.ok(ics.includes('SUMMARY:Dinner: Spaghetti Bolognese'), 'SUMMARY mismatch');
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260610'), 'DTSTART mismatch');
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260611'), 'DTEND should be date+1');
  assert.ok(ics.includes('CATEGORIES:Dinner'), 'CATEGORIES mismatch');
});

test('CRLF injection → newlines in title/location must not create extra VEVENT boundaries', () => {
  const master = makeMaster({
    id: 'evt-inj',
    title: 'Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT',
    location: 'Place\nEND:VEVENT',
  });
  const ics = buildFeed([cat], [master], [], []);

  // Split by iCal line separator (CRLF) and count actual line-level boundaries.
  // Escaped text (e.g. \nEND:VEVENT inside a SUMMARY value) must NOT produce
  // real VEVENT boundaries.
  const lines = ics.split('\r\n');
  const beginCount = lines.filter((l) => l === 'BEGIN:VEVENT').length;
  const endCount = lines.filter((l) => l === 'END:VEVENT').length;
  assert.equal(beginCount, 1, 'should have exactly 1 BEGIN:VEVENT');
  assert.equal(endCount, 1, 'should have exactly 1 END:VEVENT');
});

test('bad RRULE on one event does not break the whole feed', () => {
  const good = makeMaster({ id: 'evt-good', title: 'Good Event' });
  const bad = makeMaster({
    id: 'evt-bad',
    title: 'Bad Event',
    rrule: 'NOT_A_VALID_RRULE_;;;GARBAGE',
  });
  // buildFeed should not throw
  const ics = buildFeed([cat], [good, bad], [], []);

  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'feed should still be valid');
  assert.ok(ics.includes('UID:evt-good@homecal'), 'good event should survive');
  // The bad event may or may not be present — the key thing is no throw.
  // ical-generator passes raw RRULE strings through without validating,
  // so it might actually appear. The contract is: no throw.
});

test('feed includes CALSCALE:GREGORIAN and PRODID', () => {
  const ics = buildFeed([], [], [], []);

  assert.ok(ics.includes('CALSCALE:GREGORIAN'), 'CALSCALE missing');
  assert.ok(ics.includes('PRODID:-//homecal//EN'), 'PRODID mismatch');
});

test('feed includes LAST-MODIFIED from updatedAt', () => {
  const master = makeMaster({ updatedAt: '2026-05-20T14:30:00Z' });
  const ics = buildFeed([cat], [master], [], []);

  assert.ok(ics.includes('LAST-MODIFIED:20260520T143000Z'), 'LAST-MODIFIED mismatch');
});
