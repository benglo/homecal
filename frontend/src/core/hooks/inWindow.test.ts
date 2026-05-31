import { describe, it, expect } from 'vitest';
import { inWindow } from './useMutations';

// Window keys are ['events', startIso, endIso] (UTC). A 10-day Brisbane agenda window
// starting 2026-06-01 → 2026-06-11 maps to 2026-05-31T14:00Z .. 2026-06-10T14:00Z.
const KEY = ['events', '2026-05-31T14:00:00.000Z', '2026-06-10T14:00:00.000Z'];

describe('inWindow', () => {
  it('includes a timed event inside the window', () => {
    expect(inWindow(KEY, '2026-06-02T08:00:00.000Z')).toBe(true);
  });

  it('excludes a timed event after the window', () => {
    expect(inWindow(KEY, '2026-06-20T08:00:00.000Z')).toBe(false);
  });

  it('includes a bare YYYY-MM-DD all-day start within the Brisbane window', () => {
    // Brisbane offset makes the bare date sort after the window-start key.
    expect(inWindow(KEY, '2026-06-02')).toBe(true);
    expect(inWindow(KEY, '2026-05-30')).toBe(false);
  });

  it('is false for a malformed key', () => {
    expect(inWindow(['events'], '2026-06-02T08:00:00.000Z')).toBe(false);
  });
});
