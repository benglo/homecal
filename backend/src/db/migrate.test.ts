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

  assert.equal(db.pragma('user_version', { simple: true }), 7);
});

test('v7 adds tts_provider and tts_latency_ms columns to voice_utterances', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const cols = db.prepare("SELECT name, type FROM pragma_table_info('voice_utterances')").all() as { name: string; type: string }[];
  const byName = Object.fromEntries(cols.map(c => [c.name, c.type]));
  assert.equal(byName.tts_provider, 'TEXT');
  assert.equal(byName.tts_latency_ms, 'INTEGER');

  // No CHECK constraint on tts_provider — enum is enforced in Zod only.
  db.prepare(`INSERT INTO voice_utterances
    (id, created_at, transcript, status, tts_provider, tts_latency_ms)
    VALUES ('t1', '2026-06-08T00:00:00Z', 'x', 'applied', 'kokoro_lan', 123)`).run();
  const row = db.prepare(`SELECT tts_provider, tts_latency_ms FROM voice_utterances WHERE id='t1'`).get() as { tts_provider: string; tts_latency_ms: number };
  assert.equal(row.tts_provider, 'kokoro_lan');
  assert.equal(row.tts_latency_ms, 123);

  assert.equal(db.pragma('user_version', { simple: true }), 7);
});
