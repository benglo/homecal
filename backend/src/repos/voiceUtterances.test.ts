import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { setupIsolatedDb } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR at load time.
// See backend/src/test/util/bootstrap.ts for the rationale; the dynamic
// import below pulls in db/config AFTER DATA_DIR is set.
setupIsolatedDb('voiceUtterances-repo');

let insertUtterance: typeof import('./voiceUtterances').insertUtterance;
let listUtterances: typeof import('./voiceUtterances').listUtterances;
let db: Database.Database;

before(async () => {
  const repo = await import('./voiceUtterances');
  insertUtterance = repo.insertUtterance;
  listUtterances = repo.listUtterances;
  const dbMod = await import('../db');
  db = dbMod.getDb();
});

beforeEach(() => {
  db.exec('DELETE FROM voice_utterances');
});

test('insert + list', () => {
  insertUtterance({
    id: '0191ec00-0000-7000-8000-000000000001',
    transcript: "tonight's dinner is tacos",
    intentJson: '{"intent":"dinner_set","date":"2026-06-04","meal":"tacos","confidence":0.92}',
    confidence: 0.92,
    status: 'applied',
    durationMs: 4200,
    error: null,
    source: 'matcher',
  });
  const rows = listUtterances({ limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transcript, "tonight's dinner is tacos");
  assert.equal(rows[0].confidence, 0.92);
  assert.equal(rows[0].status, 'applied');
  assert.equal(rows[0].source, 'matcher');
});

test('insert: status CHECK rejects garbage', () => {
  assert.throws(() =>
    insertUtterance({
      id: '0191ec00-0000-7000-8000-000000000002',
      transcript: 'whatever',
      intentJson: null,
      confidence: null,
      status: 'bogus' as any,
      durationMs: null,
      error: null,
      source: null,
    }),
    /CHECK/
  );
});

test('insert: source CHECK rejects garbage', () => {
  assert.throws(() =>
    insertUtterance({
      id: '0191ec00-0000-7000-8000-000000000005',
      transcript: 'x',
      intentJson: null,
      confidence: null,
      status: 'applied',
      durationMs: null,
      error: null,
      source: 'guessed' as any,
    }),
    /CHECK/
  );
});

test('insert: source defaults to null when caller passes null', () => {
  insertUtterance({
    id: '0191ec00-0000-7000-8000-000000000003',
    transcript: '[blank]',
    intentJson: null,
    confidence: null,
    status: 'silent_low_conf',
    durationMs: null,
    error: null,
    source: null,
  });
  const [row] = listUtterances({ limit: 1 });
  assert.equal(row.source, null);
});

test('list: ordered newest-first, honours limit', () => {
  for (let i = 0; i < 5; i++) {
    insertUtterance({
      id: `0191ec00-0000-7000-8000-00000000000${i}`,
      transcript: `utterance ${i}`,
      intentJson: null,
      confidence: null,
      status: 'failed',
      durationMs: null,
      error: null,
      source: null,
    });
  }
  const rows = listUtterances({ limit: 3 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].transcript, 'utterance 4');
});
