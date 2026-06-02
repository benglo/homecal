import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR at load time.
// See bootstrap.ts for the full rationale.
setupIsolatedDb('fmtest');

let app: FastifyInstance;

before(async () => {
  // Dynamic import: route modules transitively load db/config, which read
  // DATA_DIR at module evaluation. Static `import` would hoist above the
  // setupIsolatedDb() call above.
  const { familyMemberRoutes } = await import('./familyMembers');
  const { choreRoutes } = await import('./chores');
  app = await createTestApp(familyMemberRoutes, choreRoutes);
});

after(async () => {
  await app.close();
  // Do NOT closeDb() or rmSync(tmpDir) — see bootstrap.ts.
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
