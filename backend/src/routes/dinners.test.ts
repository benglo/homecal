import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

setupIsolatedDb('dinners-route');

let app: FastifyInstance;

before(async () => {
  const { dinnerRoutes } = await import('./dinners');
  app = await createTestApp(dinnerRoutes);

  // Seed via the real PUT path so trim-on-write is exercised too.
  await app.inject({ method: 'PUT', url: '/api/dinners/2026-05-01', payload: { meal: 'Tacos' } });
  await app.inject({ method: 'PUT', url: '/api/dinners/2026-05-02', payload: { meal: '  Tacos  ' } }); // trims to 'Tacos'
  await app.inject({ method: 'PUT', url: '/api/dinners/2026-05-03', payload: { meal: 'Pasta' } });
});

after(async () => {
  await app.close();
});

test('PUT /api/dinners trims whitespace before persisting', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners?start=2026-05-02&end=2026-05-02' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Array<{ date: string; meal: string }>;
  assert.equal(body[0].meal, 'Tacos'); // not '  Tacos  '
});

test('GET /api/dinners/suggestions returns ranked suggestions with default limit', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Array<{ meal: string; count: number; lastUsed: string }>;
  // 'Tacos' appears twice (after trim), 'Pasta' once.
  assert.deepEqual(body.map((s) => s.meal), ['Tacos', 'Pasta']);
  assert.equal(body[0].count, 2);
  assert.equal(body[1].count, 1);
});

test('GET /api/dinners/suggestions honours ?limit=', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions?limit=1' });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as unknown[]).length, 1);
});

test('GET /api/dinners/suggestions rejects non-positive limit with VALIDATION code', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions?limit=0' });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'VALIDATION');
});

test('GET /api/dinners/suggestions rejects non-numeric limit', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions?limit=foo' });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'VALIDATION');
});
