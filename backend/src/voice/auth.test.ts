import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { requirePiToken } from './auth';

test('requirePiToken: 200 when header matches', async () => {
  const app = Fastify();
  app.addHook('preHandler', requirePiToken('s3cret'));
  app.get('/ok', async () => ({ ok: true }));
  const r = await app.inject({ method: 'GET', url: '/ok', headers: { 'x-pi-token': 's3cret' } });
  assert.equal(r.statusCode, 200);
  await app.close();
});

test('requirePiToken: 401 when header missing', async () => {
  const app = Fastify();
  app.addHook('preHandler', requirePiToken('s3cret'));
  app.get('/ok', async () => ({ ok: true }));
  const r = await app.inject({ method: 'GET', url: '/ok' });
  assert.equal(r.statusCode, 401);
  const body = JSON.parse(r.body);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  await app.close();
});

test('requirePiToken: 401 when header wrong', async () => {
  const app = Fastify();
  app.addHook('preHandler', requirePiToken('s3cret'));
  app.get('/ok', async () => ({ ok: true }));
  const r = await app.inject({ method: 'GET', url: '/ok', headers: { 'x-pi-token': 'wrong' } });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('requirePiToken: no token configured = service unavailable', async () => {
  const app = Fastify();
  app.addHook('preHandler', requirePiToken(''));
  app.get('/ok', async () => ({ ok: true }));
  const r = await app.inject({ method: 'GET', url: '/ok', headers: { 'x-pi-token': 'anything' } });
  assert.equal(r.statusCode, 503);
  await app.close();
});
