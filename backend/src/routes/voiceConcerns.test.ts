import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

setupIsolatedDb('voiceConcerns-route');

let app: FastifyInstance;

before(async () => {
  const { voiceConcernsRoutes } = await import('./voiceConcerns');
  app = await createTestApp(voiceConcernsRoutes);
});

after(async () => {
  await app.close();
});

beforeEach(async () => {
  const { getDb } = await import('../db');
  getDb().exec('DELETE FROM voice_utterances');
});

async function seed(rows: Array<{
  id: string; created_at: string; transcript: string;
  intent_name: string; answer: string | null; concern: number | null;
}>) {
  const { getDb } = await import('../db');
  const stmt = getDb().prepare(`
    INSERT INTO voice_utterances (id, created_at, transcript, status, intent_name, answer, concern)
    VALUES (?, ?, ?, 'applied', ?, ?, ?)
  `);
  for (const r of rows) stmt.run(r.id, r.created_at, r.transcript, r.intent_name, r.answer, r.concern);
}

test('GET /api/voice/concerns returns only concern=1 rows since the given timestamp', async () => {
  await seed([
    { id: 'a', created_at: '2026-06-06T10:00:00Z', transcript: 'why is the sky blue', intent_name: 'ask_question', answer: 'because…', concern: null },
    { id: 'b', created_at: '2026-06-06T11:00:00Z', transcript: 'my tummy hurts', intent_name: 'ask_question', answer: 'tell mum', concern: 1 },
    { id: 'c', created_at: '2026-05-29T11:00:00Z', transcript: 'old concern', intent_name: 'ask_question', answer: 'old reply', concern: 1 },
  ]);

  const res = await app.inject({ method: 'GET', url: '/api/voice/concerns?since=2026-06-01T00:00:00Z' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 'b');
  assert.equal(body[0].transcript, 'my tummy hurts');
  assert.equal(body[0].answer, 'tell mum');
  assert.equal(body[0].intentName, 'ask_question');
});

test('GET /api/voice/concerns defaults `since` to 7 days ago when omitted', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/voice/concerns' });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.json()));
});

test('GET /api/voice/concerns rejects malformed `since` with 400 + error envelope', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/voice/concerns?since=not-a-date' });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.ok(body.error);
  assert.equal(typeof body.error.code, 'string');
  assert.equal(typeof body.error.message, 'string');
});

test('GET /api/voice/concerns orders by created_at DESC', async () => {
  await seed([
    { id: 'a', created_at: '2026-06-06T08:00:00Z', transcript: 'first', intent_name: 'ask_question', answer: 'reply a', concern: 1 },
    { id: 'b', created_at: '2026-06-06T10:00:00Z', transcript: 'second', intent_name: 'ask_question', answer: 'reply b', concern: 1 },
  ]);
  const res = await app.inject({ method: 'GET', url: '/api/voice/concerns?since=2026-06-01T00:00:00Z' });
  const body = res.json();
  assert.equal(body[0].id, 'b'); // newest first
  assert.equal(body[1].id, 'a');
});
