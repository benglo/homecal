import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { mapSlotSelection, mapDateClick, defaultSlot } from './slotSelection';
import { ZONE } from '../../core/util/time';

// FC hands us local JS Dates; the kiosk/desktop browser runs in Brisbane.
const bne = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toJSDate();
const NOW = DateTime.fromISO('2026-06-11T09:10:00', { zone: ZONE });

describe('mapSlotSelection — week (timeGrid)', () => {
  it('widens a bare 30-min tap to a 1-hour draft', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-11T14:00:00'), end: bne('2026-06-11T14:30:00'), allDay: false }, NOW),
    ).toEqual({ date: '2026-06-11', time: '14:00', endTime: '15:00', allDay: false });
  });

  it('keeps an explicit drag range exactly', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-11T14:00:00'), end: bne('2026-06-11T16:00:00'), allDay: false }, NOW),
    ).toEqual({ date: '2026-06-11', time: '14:00', endTime: '16:00', allDay: false });
  });

  it('widening a 23:30 tap rolls endTime past midnight', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-11T23:30:00'), end: bne('2026-06-12T00:00:00'), allDay: false }, NOW),
    ).toEqual({ date: '2026-06-11', time: '23:30', endTime: '00:30', allDay: false });
  });
});

describe('mapSlotSelection — month (dayGrid)', () => {
  it('single day tap → timed draft at next half-hour on that day', () => {
    // NOW is 09:10 → nextHalfHour is 09:30
    expect(
      mapSlotSelection({ start: bne('2026-06-20T00:00:00'), end: bne('2026-06-21T00:00:00'), allDay: true }, NOW),
    ).toEqual({ date: '2026-06-20', time: '09:30', endTime: '10:30', allDay: false });
  });

  it('multi-day drag → all-day range (FC end is exclusive)', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-20T00:00:00'), end: bne('2026-06-23T00:00:00'), allDay: true }, NOW),
    ).toEqual({ date: '2026-06-20', endDate: '2026-06-22', allDay: true });
  });
});

describe('mapDateClick — single tap', () => {
  it('week tap (timed point) → 1-hour draft', () => {
    expect(
      mapDateClick({ date: bne('2026-06-11T14:00:00'), allDay: false }, NOW),
    ).toEqual({ date: '2026-06-11', time: '14:00', endTime: '15:00', allDay: false });
  });

  it('month tap (all-day point) → timed draft at next half-hour, NOT an inverted range', () => {
    // NOW is 09:10 → nextHalfHour 09:30. Must not produce endDate < date.
    expect(
      mapDateClick({ date: bne('2026-06-20T00:00:00'), allDay: true }, NOW),
    ).toEqual({ date: '2026-06-20', time: '09:30', endTime: '10:30', allDay: false });
  });
});

describe('defaultSlot', () => {
  it('today at next half-hour, 1h duration (the + button path)', () => {
    expect(defaultSlot(NOW)).toEqual({ date: '2026-06-11', time: '09:30', endTime: '10:30', allDay: false });
  });

  it('rolls 09:40 up to 10:00', () => {
    expect(defaultSlot(DateTime.fromISO('2026-06-11T09:40:00', { zone: ZONE }))).toEqual({
      date: '2026-06-11', time: '10:00', endTime: '11:00', allDay: false,
    });
  });
});
