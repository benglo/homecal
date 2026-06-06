import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate';

test('v6 adds intent_name, answer, concern columns; no CHECK constraint on intent_name', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const cols = db.prepare("SELECT name, type FROM pragma_table_info('voice_utterances')").all() as { name: string; type: string }[];
  const byName = Object.fromEntries(cols.map(c => [c.name, c.type]));
  assert.equal(byName.intent_name, 'TEXT');
  assert.equal(byName.answer, 'TEXT');
  assert.equal(byName.concern, 'INTEGER');

  // No CHECK constraint on intent_name — verify by inserting an arbitrary string.
  db.prepare(`INSERT INTO voice_utterances
    (id, created_at, transcript, status, intent_name)
    VALUES ('t1', '2026-06-06T00:00:00Z', 'x', 'applied', 'some_future_intent')`).run();
  const row = db.prepare(`SELECT intent_name FROM voice_utterances WHERE id='t1'`).get() as { intent_name: string };
  assert.equal(row.intent_name, 'some_future_intent');

  assert.equal(db.pragma('user_version', { simple: true }), 6);
});
