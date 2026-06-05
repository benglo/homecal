import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { setupIsolatedDb } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR at load time.
// See backend/src/test/util/bootstrap.ts for the rationale; the dynamic
// import below pulls in db/config AFTER DATA_DIR is set.
setupIsolatedDb('dinners-repo');

let listSuggestions: typeof import('./dinners').listSuggestions;
let db: Database.Database;

before(async () => {
  const repo = await import('./dinners');
  listSuggestions = repo.listSuggestions;
  const dbMod = await import('../db');
  db = dbMod.getDb();
});

beforeEach(() => {
  db.exec('DELETE FROM dinners');
});

function seed(date: string, meal: string, updatedAt: string) {
  db.prepare('INSERT INTO dinners (date, meal, updated_at) VALUES (?, ?, ?)').run(
    date,
    meal,
    updatedAt,
  );
}

test('listSuggestions returns [] when no dinners exist', () => {
  assert.deepEqual(listSuggestions(20), []);
});

test('listSuggestions orders by frequency desc, then last_used desc', () => {
  seed('2026-05-01', 'Tacos',  '2026-05-01T09:00:00Z');
  seed('2026-05-02', 'Tacos',  '2026-05-02T09:00:00Z'); // count=2
  seed('2026-05-03', 'Pasta',  '2026-05-03T09:00:00Z'); // count=1, newest
  seed('2026-05-04', 'Soup',   '2026-04-30T09:00:00Z'); // count=1, oldest
  assert.deepEqual(
    listSuggestions(20).map((s) => s.meal),
    ['Tacos', 'Pasta', 'Soup'],
  );
});

test('listSuggestions dedupes case-insensitively; canonical = most-recent casing', () => {
  seed('2026-05-01', 'spaghetti bolognese', '2026-05-01T09:00:00Z');
  seed('2026-05-02', 'Spaghetti Bolognese', '2026-05-08T09:00:00Z'); // newest
  seed('2026-05-03', 'SPAGHETTI BOLOGNESE', '2026-05-05T09:00:00Z');
  const got = listSuggestions(20);
  assert.equal(got.length, 1);
  assert.equal(got[0].meal, 'Spaghetti Bolognese');
  assert.equal(got[0].count, 3);
  assert.equal(got[0].lastUsed, '2026-05-08T09:00:00Z');
});

test('listSuggestions canonical casing is deterministic when updated_at ties', () => {
  // Same updated_at — ties broken by meal ASC so canonical is stable.
  seed('2026-05-01', 'tacos', '2026-05-01T09:00:00Z');
  seed('2026-05-02', 'Tacos', '2026-05-01T09:00:00Z');
  seed('2026-05-03', 'TACOS', '2026-05-01T09:00:00Z');
  const got = listSuggestions(20);
  assert.equal(got.length, 1);
  // ASCII sort: 'T' < 't', and 'TACOS' < 'Tacos' < 'tacos', so 'TACOS' wins.
  assert.equal(got[0].meal, 'TACOS');
});

test('listSuggestions respects the limit', () => {
  for (let i = 0; i < 10; i++) {
    const d = String(i + 1).padStart(2, '0');
    seed(`2026-04-${d}`, `Meal ${i}`, `2026-04-${d}T09:00:00Z`);
  }
  assert.equal(listSuggestions(3).length, 3);
});
