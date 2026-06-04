import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { setupIsolatedDb } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR at load time.
// See backend/src/test/util/bootstrap.ts for the rationale; the dynamic
// import below pulls in db/config AFTER DATA_DIR is set.
setupIsolatedDb('voiceSettings-repo');

let getMuteUntil: typeof import('./voiceSettings').getMuteUntil;
let setMuteUntil: typeof import('./voiceSettings').setMuteUntil;
let db: Database.Database;

before(async () => {
  const repo = await import('./voiceSettings');
  getMuteUntil = repo.getMuteUntil;
  setMuteUntil = repo.setMuteUntil;
  const dbMod = await import('../db');
  db = dbMod.getDb();
});

test('row 1 exists after migration', () => {
  assert.equal(getMuteUntil(), null);
});

test('setMuteUntil + getMuteUntil round-trip', () => {
  setMuteUntil('2026-06-04T19:00:00Z');
  assert.equal(getMuteUntil(), '2026-06-04T19:00:00Z');
  setMuteUntil(null);
  assert.equal(getMuteUntil(), null);
});
