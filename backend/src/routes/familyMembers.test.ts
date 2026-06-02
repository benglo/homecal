import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';

// Isolate the DB per-test-file: set DATA_DIR BEFORE the db/config modules
// are loaded. Because ESM hoists static imports, we MUST use dynamic
// `await import(...)` for any module that reads `process.env.DATA_DIR`
// at load time (config.ts → db/index.ts → repos/*).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homecal-fmtest-'));
process.env.DATA_DIR = tmpDir;

let app: FastifyInstance;

before(async () => {
  // Dynamic import: this is the first time db/config are touched, so they
  // see our DATA_DIR override. node:test (Node 20) runs all *.test.ts in
  // one process; whichever route test runs first wins the DATA_DIR.
  const { familyMemberRoutes } = await import('./familyMembers');
  const { choreRoutes } = await import('./chores');

  app = Fastify({ logger: false });
  // Mirror server.ts error envelope so the response shape matches production.
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({
      error: {
        code: (err as { code?: string }).code ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  await app.register(familyMemberRoutes);
  await app.register(choreRoutes);
  await app.ready();
});

after(async () => {
  await app.close();
  // Do NOT closeDb() or rmSync(tmpDir) — the db/config singleton is module-
  // cached across all *.test.ts in the same process, and another test file
  // may still hold a reference to it. The OS reclaims /tmp.
});

interface Envelope<T> {
  error?: { code: string; message: string };
  // member fields when success
  id?: string;
  name?: string;
  icon?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

async function postMember(name: string, icon: string) {
  return app.inject({
    method: 'POST',
    url: '/api/family-members',
    payload: { name, icon },
  });
}

test('POST /api/family-members creates a member and returns 201 with full body', async () => {
  const res = await postMember('FMAlice', 'cat');
  assert.equal(res.statusCode, 201);
  const body = res.json() as Envelope<unknown>;
  assert.ok(body.id, 'id missing');
  assert.equal(body.name, 'FMAlice');
  assert.equal(body.icon, 'cat');
  assert.ok(body.updatedAt, 'updatedAt missing');
});

test('GET /api/family-members lists members alphabetically by name', async () => {
  const c = await postMember('FMCharlie', 'cow');
  assert.equal(c.statusCode, 201);
  const b = await postMember('FMBob', 'bear');
  assert.equal(b.statusCode, 201);

  const res = await app.inject({ method: 'GET', url: '/api/family-members' });
  assert.equal(res.statusCode, 200);
  const list = res.json() as Array<{ name: string }>;
  const names = list.map((m) => m.name);
  // Verify ordering of our prefixed members (sort-stable; other test files may
  // have added unrelated members).
  const idx = (n: string) => names.indexOf(n);
  assert.ok(idx('FMAlice') < idx('FMBob'), 'FMAlice should sort before FMBob');
  assert.ok(idx('FMBob') < idx('FMCharlie'), 'FMBob should sort before FMCharlie');
});

test('PUT /api/family-members/:id updates a member (name + icon both required)', async () => {
  const created = await postMember('FMDave', 'dog');
  assert.equal(created.statusCode, 201, `Dave should be new: ${created.body}`);
  const { id } = created.json() as { id: string };

  const res = await app.inject({
    method: 'PUT',
    url: `/api/family-members/${id}`,
    payload: { name: 'FMDave Renamed', icon: 'duck' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { id: string; name: string; icon: string };
  assert.equal(body.id, id);
  assert.equal(body.name, 'FMDave Renamed');
  assert.equal(body.icon, 'duck');

  // Confirm both fields are required (familyMemberUpdate = familyMemberCreate).
  const partial = await app.inject({
    method: 'PUT',
    url: `/api/family-members/${id}`,
    payload: { name: 'Only Name' },
  });
  assert.equal(partial.statusCode, 400);
  const errBody = partial.json() as Envelope<unknown>;
  assert.equal(errBody.error?.code, 'VALIDATION');
});

test('DELETE /api/family-members/:id returns 204 and member is gone', async () => {
  const created = await postMember('FMEve', 'eagle');
  assert.equal(created.statusCode, 201);
  const { id } = created.json() as { id: string };

  const del = await app.inject({ method: 'DELETE', url: `/api/family-members/${id}` });
  assert.equal(del.statusCode, 204);

  const list = await app.inject({ method: 'GET', url: '/api/family-members' });
  const members = list.json() as Array<{ id: string }>;
  assert.ok(!members.some((m) => m.id === id), 'deleted member still in list');
});

test('POST duplicate name returns 409 with code DUPLICATE_NAME', async () => {
  const a = await postMember('FMFrank', 'fox');
  assert.equal(a.statusCode, 201);
  const b = await postMember('FMFrank', 'falcon');
  assert.equal(b.statusCode, 409);
  const body = b.json() as Envelope<unknown>;
  assert.equal(body.error?.code, 'DUPLICATE_NAME');
});

test('PUT to non-existent id returns 404 with code NOT_FOUND', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/family-members/does-not-exist',
    payload: { name: 'Ghost', icon: 'ghost' },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as Envelope<unknown>;
  assert.equal(body.error?.code, 'NOT_FOUND');
});

test('DELETE non-existent id returns 404', async () => {
  const res = await app.inject({
    method: 'DELETE',
    url: '/api/family-members/does-not-exist',
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as Envelope<unknown>;
  assert.equal(body.error?.code, 'NOT_FOUND');
});

test('DELETE cascades — chores for deleted member disappear from chore list', async () => {
  const m = await postMember('FMHank', 'hare');
  assert.equal(m.statusCode, 201);
  const { id: memberId } = m.json() as { id: string };

  const chore = await app.inject({
    method: 'POST',
    url: '/api/chores',
    payload: {
      title: 'cascade-task',
      icon: 'c',
      frequency: 'daily',
      assignedTo: memberId,
    },
  });
  assert.equal(chore.statusCode, 201);
  const { id: choreId } = chore.json() as { id: string };

  const del = await app.inject({ method: 'DELETE', url: `/api/family-members/${memberId}` });
  assert.equal(del.statusCode, 204);

  const list = await app.inject({ method: 'GET', url: '/api/chores' });
  assert.equal(list.statusCode, 200);
  const chores = list.json() as Array<{ id: string }>;
  assert.ok(!chores.some((c) => c.id === choreId), 'cascaded chore still in list');
});

test('POST with empty name returns 400 with code VALIDATION', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/family-members',
    payload: { name: '', icon: 'cat' },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as Envelope<unknown>;
  assert.equal(body.error?.code, 'VALIDATION');
});
