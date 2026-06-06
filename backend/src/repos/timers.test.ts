import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { setupIsolatedDb } from '../test/util/bootstrap';

setupIsolatedDb('timers-repo');

let repo: typeof import('./timers');
let db: Database.Database;

before(async () => {
  repo = await import('./timers');
  const dbMod = await import('../db');
  db = dbMod.getDb();
});

beforeEach(() => {
  db.exec('DELETE FROM timers');
});

const T0 = new Date('2026-06-06T10:00:00Z');

test('createTimer stores duration + computes expires_at = started_at + duration', () => {
  const t = repo.createTimer({ label: 'pasta', durationSec: 600 }, T0);
  assert.equal(t.label, 'pasta');
  assert.equal(t.durationSec, 600);
  assert.equal(t.startedAt, '2026-06-06T10:00:00Z');
  assert.equal(t.expiresAt, '2026-06-06T10:10:00Z');
  assert.equal(t.acknowledgedAt, null);
  assert.match(t.id, /^[0-9a-f-]{36}$/);
});

test('createTimer allows null label', () => {
  const t = repo.createTimer({ label: null, durationSec: 60 }, T0);
  assert.equal(t.label, null);
});

test('listActiveTimers returns un-acknowledged timers ordered by expires_at asc', () => {
  const a = repo.createTimer({ label: 'a', durationSec: 60 }, T0);
  const b = repo.createTimer({ label: 'b', durationSec: 30 }, T0);
  const c = repo.createTimer({ label: 'c', durationSec: 120 }, T0);
  const ids = repo.listActiveTimers().map((t) => t.id);
  assert.deepEqual(ids, [b.id, a.id, c.id]);
});

test('listActiveTimers excludes acknowledged timers', () => {
  const a = repo.createTimer({ label: 'a', durationSec: 60 }, T0);
  repo.createTimer({ label: 'b', durationSec: 30 }, T0);
  repo.acknowledgeTimer(a.id, new Date('2026-06-06T10:01:30Z'));
  const labels = repo.listActiveTimers().map((t) => t.label);
  assert.deepEqual(labels, ['b']);
});

test('findTimerByLabel matches case-insensitively', () => {
  const t = repo.createTimer({ label: 'Pasta', durationSec: 600 }, T0);
  assert.equal(repo.findTimerByLabel('pasta')?.id, t.id);
  assert.equal(repo.findTimerByLabel('PASTA')?.id, t.id);
});

test('findTimerByLabel returns most-recently-started match', () => {
  repo.createTimer({ label: 'pasta', durationSec: 60 }, new Date('2026-06-06T09:00:00Z'));
  const newer = repo.createTimer({ label: 'pasta', durationSec: 60 }, new Date('2026-06-06T10:00:00Z'));
  assert.equal(repo.findTimerByLabel('pasta')?.id, newer.id);
});

test('findTimerByLabel skips acknowledged timers', () => {
  const a = repo.createTimer({ label: 'pasta', durationSec: 60 }, new Date('2026-06-06T10:00:00Z'));
  repo.acknowledgeTimer(a.id, new Date('2026-06-06T10:01:30Z'));
  assert.equal(repo.findTimerByLabel('pasta'), null);
});

test('findTimerByLabel(null) returns the sole active timer when only one exists', () => {
  const t = repo.createTimer({ label: 'pasta', durationSec: 60 }, T0);
  assert.equal(repo.findTimerByLabel(null)?.id, t.id);
});

test('findTimerByLabel(null) returns null when multiple active timers exist (ambiguous)', () => {
  repo.createTimer({ label: 'pasta', durationSec: 60 }, T0);
  repo.createTimer({ label: 'eggs', durationSec: 30 }, T0);
  assert.equal(repo.findTimerByLabel(null), null);
});

test('extendTimer adds seconds to expires_at + bumps duration_sec', () => {
  const t = repo.createTimer({ label: 'pasta', durationSec: 600 }, T0);
  const updated = repo.extendTimer(t.id, 120);
  assert.equal(updated.durationSec, 720);
  assert.equal(updated.expiresAt, '2026-06-06T10:12:00Z');
});

test('extendTimer throws 404 when timer not found', () => {
  assert.throws(() => repo.extendTimer('nope', 60), /Timer not found/);
});

test('cancelTimer deletes the row', () => {
  const t = repo.createTimer({ label: 'pasta', durationSec: 60 }, T0);
  repo.cancelTimer(t.id);
  assert.equal(repo.listActiveTimers().length, 0);
});

test('cancelTimer throws 404 when timer not found', () => {
  assert.throws(() => repo.cancelTimer('nope'), /Timer not found/);
});

test('acknowledgeTimer sets acknowledged_at + is idempotent', () => {
  const t = repo.createTimer({ label: 'pasta', durationSec: 60 }, T0);
  const ackAt = new Date('2026-06-06T10:01:30Z');
  const acked = repo.acknowledgeTimer(t.id, ackAt);
  assert.equal(acked.acknowledgedAt, '2026-06-06T10:01:30Z');

  // Second acknowledge keeps the original timestamp (idempotent).
  const again = repo.acknowledgeTimer(t.id, new Date('2026-06-06T10:05:00Z'));
  assert.equal(again.acknowledgedAt, '2026-06-06T10:01:30Z');
});

test('acknowledgeTimer throws 404 when timer not found', () => {
  assert.throws(() => repo.acknowledgeTimer('nope', T0), /Timer not found/);
});
