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

  assert.equal(db.pragma('user_version', { simple: true }), 10);
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

  assert.equal(db.pragma('user_version', { simple: true }), 10);
});

test('v8 adds volume + audio_muted to voice_settings, back-filled with defaults', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const cols = db.prepare("SELECT name, type FROM pragma_table_info('voice_settings')").all() as { name: string; type: string }[];
  const byName = Object.fromEntries(cols.map(c => [c.name, c.type]));
  assert.equal(byName.volume, 'INTEGER');
  assert.equal(byName.audio_muted, 'INTEGER');

  // The pre-existing singleton row is back-filled with the constant defaults.
  const row = db.prepare(`SELECT volume, audio_muted FROM voice_settings WHERE id=1`).get() as { volume: number; audio_muted: number };
  assert.equal(row.volume, 60);
  assert.equal(row.audio_muted, 0);

  // CHECK constraints reject out-of-range writes (Zod is the primary gate, but
  // the CHECK is house style for bounded columns).
  assert.throws(() => db.prepare(`UPDATE voice_settings SET volume = 150 WHERE id=1`).run());
  assert.throws(() => db.prepare(`UPDATE voice_settings SET audio_muted = 2 WHERE id=1`).run());

  assert.equal(db.pragma('user_version', { simple: true }), 10);
});

test('v9 keeps existing chores and their completions (stars survive the upgrade)', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, 8);
  db.prepare(`INSERT INTO family_members (id, name, icon) VALUES ('m1', 'Kid', 'star')`).run();
  db.prepare(`INSERT INTO chores (id, title, icon, stars, frequency, assigned_to)
    VALUES ('c1', 'Teeth', 'tooth', 2, 'daily', 'm1')`).run();
  db.prepare(`INSERT INTO chore_completions (chore_id, completed_date, completed_at)
    VALUES ('c1', '2026-11-16', '2026-11-16T21:00:00Z')`).run();

  runMigrations(db);

  assert.equal(db.pragma('user_version', { simple: true }), 10);
  const chore = db.prepare(`SELECT title, days, routine FROM chores WHERE id='c1'`).get() as
    { title: string; days: number | null; routine: string | null };
  assert.deepEqual(chore, { title: 'Teeth', days: null, routine: null });
  const n = db.prepare(`SELECT COUNT(*) AS n FROM chore_completions WHERE chore_id='c1'`).get() as { n: number };
  assert.equal(n.n, 1);
});

test('v9 CHECKs reject bad day masks, routines and times', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare(`INSERT INTO family_members (id, name, icon) VALUES ('m1', 'Kid', 'star')`).run();
  assert.throws(() => db.prepare(`INSERT INTO chores (id, title, icon, frequency, assigned_to, days)
    VALUES ('c1', 't', 'i', 'daily', 'm1', 0)`).run());
  assert.throws(() => db.prepare(`INSERT INTO chores (id, title, icon, frequency, assigned_to, routine)
    VALUES ('c2', 't', 'i', 'daily', 'm1', 'lunch')`).run());
  assert.throws(() => db.prepare(`INSERT INTO routines (id, kind, time) VALUES ('r1', 'bed', '25:00')`).run());
  assert.throws(() => db.prepare(`INSERT INTO routines (id, kind, time) VALUES ('r2', 'nap', '13:00')`).run());
  db.prepare(`INSERT INTO routines (id, kind, time, days) VALUES ('r3', 'bed', '19:30', 62)`).run();
});

test('v9 seeds the routine_settings singleton; v10 keeps its values as lock_ends', () => {
  const db = new Database(':memory:');
  runMigrations(db, 9);
  const v9 = db.prepare('SELECT * FROM routine_settings').all() as Array<Record<string, unknown>>;
  assert.equal(v9.length, 1);
  assert.equal(v9[0].night_end, '05:00');
  assert.throws(() => db.prepare("UPDATE routine_settings SET night_end = '13:00'").run());
  db.prepare("UPDATE routine_settings SET night_end = '06:15', warn_minutes = 7, bath_locks = 0").run();

  runMigrations(db);
  assert.equal(db.pragma('user_version', { simple: true }), 10);
  const row = db.prepare('SELECT * FROM routine_settings').get() as Record<string, unknown>;
  assert.equal(row.lock_ends, '06:15');
  assert.equal(row.warn_minutes, 7);
  assert.equal(row.bath_locks, 0);
  assert.equal('night_end' in row, false);
  db.prepare("UPDATE routine_settings SET lock_ends = '20:00'").run();
  assert.throws(() => db.prepare("INSERT INTO routine_settings (id) VALUES (2)").run());
  assert.throws(() => db.prepare("UPDATE routine_settings SET lock_ends = '8pm'").run());
});
