import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR at load time.
// See bootstrap.ts for the full rationale.
setupIsolatedDb('choretest');

let app: FastifyInstance;
let memberId: string;
let todayBrisbane: () => string;

before(async () => {
  // Dynamic import: route + util modules transitively load db/config.
  const familyRoutes = await import('./familyMembers');
  const choreRoutesMod = await import('./chores');
  const time = await import('../util/time');
  todayBrisbane = time.todayBrisbane;

  app = await createTestApp(familyRoutes.familyMemberRoutes, choreRoutesMod.choreRoutes);

  // Seed a family member dedicated to this test file. Use a name unlikely
  // to collide with other test files that may share the DB singleton.
  const seedName = `ChoreTestSeed-${Date.now()}`;
  const m = await app.inject({
    method: 'POST',
    url: '/api/family-members',
    payload: { name: seedName, icon: 'star' },
  });
  if (m.statusCode !== 201) throw new Error(`seed failed: ${m.body}`);
  memberId = (m.json() as { id: string }).id;
});

after(async () => {
  await app.close();
  // Do NOT closeDb() or rmSync(tmpDir) — see bootstrap.ts.
});

interface Envelope {
  error?: { code: string; message: string };
}

async function postChore(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/chores', payload });
}

test('POST /api/chores creates a chore and returns 201 with body', async () => {
  const res = await postChore({
    title: 'brush teeth',
    icon: 'tooth',
    frequency: 'daily',
    assignedTo: memberId,
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as {
    id: string;
    title: string;
    icon: string;
    frequency: string;
    assignedTo: string;
    updatedAt: string;
  };
  assert.ok(body.id);
  assert.equal(body.title, 'brush teeth');
  assert.equal(body.assignedTo, memberId);
  assert.equal(body.frequency, 'daily');
  assert.ok(body.updatedAt);
});

test('GET /api/chores lists chores sorted (assignedTo, position, title)', async () => {
  await postChore({ title: 'b-task', icon: 'b', frequency: 'daily', assignedTo: memberId, position: 1 });
  await postChore({ title: 'a-task', icon: 'a', frequency: 'daily', assignedTo: memberId, position: 0 });

  const res = await app.inject({ method: 'GET', url: '/api/chores' });
  assert.equal(res.statusCode, 200);
  const chores = res.json() as Array<{ title: string; assignedTo: string; position: number }>;
  // Within the same member, position 0 must come before position 1.
  const mine = chores.filter((c) => c.assignedTo === memberId);
  const posA = mine.findIndex((c) => c.title === 'a-task');
  const posB = mine.findIndex((c) => c.title === 'b-task');
  assert.ok(posA >= 0 && posB >= 0, 'seeded chores not found');
  assert.ok(posA < posB, 'a-task (position 0) should come before b-task (position 1)');
});

test('GET /api/chores/:id returns 200 for existing chore', async () => {
  const c = await postChore({
    title: 'fetchme',
    icon: 'f',
    frequency: 'daily',
    assignedTo: memberId,
  });
  const { id } = c.json() as { id: string };

  const res = await app.inject({ method: 'GET', url: `/api/chores/${id}` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { id: string; title: string };
  assert.equal(body.id, id);
  assert.equal(body.title, 'fetchme');
});

test('GET /api/chores/:id returns 404 for missing chore', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/chores/does-not-exist' });
  assert.equal(res.statusCode, 404);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'NOT_FOUND');
});

test('PUT /api/chores/:id updates a chore (returns merged body)', async () => {
  const c = await postChore({
    title: 'original',
    icon: 'o',
    frequency: 'daily',
    assignedTo: memberId,
  });
  const { id } = c.json() as { id: string };

  const res = await app.inject({
    method: 'PUT',
    url: `/api/chores/${id}`,
    payload: { title: 'updated', stars: 3 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { id: string; title: string; stars: number; icon: string };
  assert.equal(body.id, id);
  assert.equal(body.title, 'updated');
  assert.equal(body.stars, 3);
  assert.equal(body.icon, 'o', 'unchanged field should persist');
});

test('DELETE /api/chores/:id returns 204', async () => {
  const c = await postChore({
    title: 'deleteme',
    icon: 'd',
    frequency: 'daily',
    assignedTo: memberId,
  });
  const { id } = c.json() as { id: string };

  const res = await app.inject({ method: 'DELETE', url: `/api/chores/${id}` });
  assert.equal(res.statusCode, 204);

  const followup = await app.inject({ method: 'GET', url: `/api/chores/${id}` });
  assert.equal(followup.statusCode, 404);
});

test('POST with invalid assignedTo returns 400 with code INVALID_MEMBER', async () => {
  const res = await postChore({
    title: 'orphan',
    icon: 'x',
    frequency: 'daily',
    assignedTo: 'does-not-exist',
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'INVALID_MEMBER');
});

test('POST weekly chore without dayOfWeek returns 400 (Zod refine)', async () => {
  const res = await postChore({
    title: 'bad-weekly',
    icon: 'x',
    frequency: 'weekly',
    assignedTo: memberId,
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'VALIDATION');
});

test('POST daily chore with dayOfWeek returns 400', async () => {
  const res = await postChore({
    title: 'bad-daily',
    icon: 'x',
    frequency: 'daily',
    dayOfWeek: 2,
    assignedTo: memberId,
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'VALIDATION');
});

test('PUT changing frequency to daily while keeping dayOfWeek returns 400 INVALID_DAY_OF_WEEK', async () => {
  // Start with a valid weekly chore.
  const c = await postChore({
    title: 'weekly-then-daily',
    icon: 'w',
    frequency: 'weekly',
    dayOfWeek: 3,
    assignedTo: memberId,
  });
  const { id } = c.json() as { id: string };

  // Change frequency to daily without clearing dayOfWeek — should fail in updateChore.
  const res = await app.inject({
    method: 'PUT',
    url: `/api/chores/${id}`,
    payload: { frequency: 'daily' },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'INVALID_DAY_OF_WEEK');
});

test('GET /api/chore-board?date=YYYY-MM-DD returns 200 with { date, members } structure', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/chore-board?date=2026-06-02' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    date: string;
    members: Array<{ id: string; name: string; icon: string; totalStars: number; chores: unknown[] }>;
  };
  assert.equal(body.date, '2026-06-02');
  assert.ok(Array.isArray(body.members), 'members should be an array');
  // Seeded member should be present.
  assert.ok(body.members.some((m) => m.id === memberId), 'seed member missing from board');
});

test('GET /api/chore-board?date=bad returns 400', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/chore-board?date=not-a-date' });
  assert.equal(res.statusCode, 400);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'VALIDATION');
});

test('GET /api/chore-board with no date returns 200 and uses today (Brisbane)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/chore-board' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { date: string };
  assert.equal(body.date, todayBrisbane());
});

test('POST /api/chores/:id/complete returns 201 first time, 200 second time (idempotent)', async () => {
  const c = await postChore({
    title: 'idempotent',
    icon: 'i',
    frequency: 'daily',
    assignedTo: memberId,
  });
  const { id } = c.json() as { id: string };
  const date = '2026-06-02';

  const first = await app.inject({
    method: 'POST',
    url: `/api/chores/${id}/complete`,
    payload: { date },
  });
  assert.equal(first.statusCode, 201);
  const firstBody = first.json() as { choreId: string; completedDate: string; completedAt: string };
  assert.equal(firstBody.choreId, id);
  assert.equal(firstBody.completedDate, date);

  const second = await app.inject({
    method: 'POST',
    url: `/api/chores/${id}/complete`,
    payload: { date },
  });
  assert.equal(second.statusCode, 200);
});

test('POST complete on non-existent chore returns 404', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chores/does-not-exist/complete',
    payload: { date: '2026-06-02' },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'NOT_FOUND');
});

test('DELETE /api/chores/:id/complete/:date returns 204', async () => {
  const c = await postChore({
    title: 'uncomplete-me',
    icon: 'u',
    frequency: 'daily',
    assignedTo: memberId,
  });
  const { id } = c.json() as { id: string };
  const date = '2026-06-03';

  // Complete first so we have something to delete.
  const completeRes = await app.inject({
    method: 'POST',
    url: `/api/chores/${id}/complete`,
    payload: { date },
  });
  assert.equal(completeRes.statusCode, 201);

  const res = await app.inject({
    method: 'DELETE',
    url: `/api/chores/${id}/complete/${date}`,
  });
  assert.equal(res.statusCode, 204);
});

test('DELETE complete on non-existent (chore_id, date) returns 404', async () => {
  const c = await postChore({
    title: 'no-completion',
    icon: 'n',
    frequency: 'daily',
    assignedTo: memberId,
  });
  const { id } = c.json() as { id: string };

  const res = await app.inject({
    method: 'DELETE',
    url: `/api/chores/${id}/complete/2026-06-04`,
  });
  assert.equal(res.statusCode, 404);
  const body = res.json() as Envelope;
  assert.equal(body.error?.code, 'NOT_FOUND');
});
