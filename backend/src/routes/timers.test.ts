import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

setupIsolatedDb('timers-route');

let app: FastifyInstance;

before(async () => {
  const { timerRoutes } = await import('./timers');
  app = await createTestApp(timerRoutes);
});

after(async () => {
  await app.close();
});

beforeEach(async () => {
  const { getDb } = await import('../db');
  getDb().exec('DELETE FROM timers');
});

test('POST /api/timers creates a timer and returns 201 with the row', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/timers',
    payload: { label: 'pasta', durationSec: 600 },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as { id: string; label: string; durationSec: number; expiresAt: string };
  assert.equal(body.label, 'pasta');
  assert.equal(body.durationSec, 600);
  assert.match(body.id, /^[0-9a-f-]{36}$/);
});

test('POST /api/timers rejects duration > 8h', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/timers',
    payload: { label: 'overnight', durationSec: 9 * 3600 },
  });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'VALIDATION');
});

test('POST /api/timers rejects duration < 5s', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/timers',
    payload: { label: 'tiny', durationSec: 1 },
  });
  assert.equal(res.statusCode, 400);
});

test('POST /api/timers accepts null label', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/timers',
    payload: { label: null, durationSec: 60 },
  });
  assert.equal(res.statusCode, 201);
  assert.equal((res.json() as { label: string | null }).label, null);
});

test('GET /api/timers returns active timers sorted by expires_at', async () => {
  await app.inject({ method: 'POST', url: '/api/timers', payload: { label: 'long', durationSec: 600 } });
  await app.inject({ method: 'POST', url: '/api/timers', payload: { label: 'short', durationSec: 30 } });
  const res = await app.inject({ method: 'GET', url: '/api/timers' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Array<{ label: string }>;
  assert.deepEqual(body.map((t) => t.label), ['short', 'long']);
});

test('PATCH /api/timers/:id extends the timer', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/timers',
    payload: { label: 'pasta', durationSec: 600 },
  });
  const { id, expiresAt } = created.json() as { id: string; expiresAt: string };

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/timers/${id}`,
    payload: { addSec: 120 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { durationSec: number; expiresAt: string };
  assert.equal(body.durationSec, 720);
  assert.equal(Date.parse(body.expiresAt) - Date.parse(expiresAt), 120_000);
});

test('PATCH /api/timers/:id returns 404 when unknown', async () => {
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/timers/does-not-exist',
    payload: { addSec: 60 },
  });
  assert.equal(res.statusCode, 404);
});

test('DELETE /api/timers/:id cancels the timer + returns 204', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/timers',
    payload: { label: 'pasta', durationSec: 600 },
  });
  const { id } = created.json() as { id: string };

  const res = await app.inject({ method: 'DELETE', url: `/api/timers/${id}` });
  assert.equal(res.statusCode, 204);

  const list = await app.inject({ method: 'GET', url: '/api/timers' });
  assert.deepEqual(list.json(), []);
});

test('DELETE /api/timers/:id returns 404 when unknown', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/timers/nope' });
  assert.equal(res.statusCode, 404);
});

test('POST /api/timers/:id/acknowledge stamps acknowledged_at + drops from active list', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/timers',
    payload: { label: 'pasta', durationSec: 60 },
  });
  const { id } = created.json() as { id: string };

  const ack = await app.inject({ method: 'POST', url: `/api/timers/${id}/acknowledge` });
  assert.equal(ack.statusCode, 200);
  assert.notEqual((ack.json() as { acknowledgedAt: string | null }).acknowledgedAt, null);

  const list = await app.inject({ method: 'GET', url: '/api/timers' });
  assert.deepEqual(list.json(), []);
});
