import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR at load time.
setupIsolatedDb('routinetest');

let app: FastifyInstance;
let memberId: string;
let todayBrisbane: () => string;
let pokes: Array<{ kind: string; payload?: unknown }> = [];

// 2026-11-15 is a Sunday, 2026-11-16 a Monday.
const SUNDAY = '2026-11-15';
const MONDAY = '2026-11-16';
const WEEKDAYS = 62;

before(async () => {
  const familyRoutes = await import('./familyMembers');
  const choreRoutesMod = await import('./chores');
  const routineRoutesMod = await import('./routines');
  const dinnerRoutesMod = await import('./dinners');
  const realtime = await import('../realtime');
  const time = await import('../util/time');
  todayBrisbane = time.todayBrisbane;
  realtime.broker.subscribe((p) => pokes.push({ kind: p.kind, payload: p.payload }));

  app = await createTestApp(
    familyRoutes.familyMemberRoutes,
    choreRoutesMod.choreRoutes,
    routineRoutesMod.routineRoutes,
    dinnerRoutesMod.dinnerRoutes
  );

  const m = await app.inject({
    method: 'POST',
    url: '/api/family-members',
    payload: { name: `RoutineKid-${Date.now()}`, icon: '🦄' },
  });
  if (m.statusCode !== 201) throw new Error(`seed failed: ${m.body}`);
  memberId = (m.json() as { id: string }).id;
});

after(async () => {
  await app.close();
});

interface PlanMember {
  id: string;
  checklists: { morning: Array<{ id: string; title: string; done: boolean }>; bedtime: unknown[] };
}
interface Plan {
  date: string;
  members: PlanMember[];
  routines: Array<{ id: string; kind: string; at: string; memberId: string | null }>;
  dinner: { meal: string } | null;
  dinnerCall: { id: string; calledAt: string } | null;
}

async function plan(date?: string): Promise<Plan> {
  const res = await app.inject({ method: 'GET', url: `/api/day-plan${date ? `?date=${date}` : ''}` });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as Plan;
}

test('routines CRUD round-trip with defaults and poke', async () => {
  pokes = [];
  const created = await app.inject({
    method: 'POST',
    url: '/api/routines',
    payload: { kind: 'bed', time: '19:30' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const r = created.json() as { id: string; days: number; memberId: string | null };
  assert.equal(r.days, 127);
  assert.equal(r.memberId, null);
  assert.ok(pokes.some((p) => p.kind === 'routines'));

  const upd = await app.inject({
    method: 'PUT',
    url: `/api/routines/${r.id}`,
    payload: { time: '19:45', memberId },
  });
  assert.equal(upd.statusCode, 200, upd.body);
  assert.equal((upd.json() as { time: string }).time, '19:45');

  const del = await app.inject({ method: 'DELETE', url: `/api/routines/${r.id}` });
  assert.equal(del.statusCode, 204);
  const again = await app.inject({ method: 'DELETE', url: `/api/routines/${r.id}` });
  assert.equal(again.statusCode, 404);
});

test('routines reject bad time, kind and unknown member', async () => {
  for (const payload of [
    { kind: 'bed', time: '24:00' },
    { kind: 'bed', time: '7:30' },
    { kind: 'nap', time: '13:00' },
    { kind: 'bath', time: '18:00', days: 0 },
  ]) {
    const res = await app.inject({ method: 'POST', url: '/api/routines', payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  const res = await app.inject({
    method: 'POST',
    url: '/api/routines',
    payload: { kind: 'bath', time: '18:00', memberId: 'nope' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'INVALID_MEMBER');
});

test('chores: days only allowed on daily chores', async () => {
  const bad = await app.inject({
    method: 'POST',
    url: '/api/chores',
    payload: { title: 'Bins', icon: '🗑', frequency: 'weekly', dayOfWeek: 2, days: WEEKDAYS, assignedTo: memberId },
  });
  assert.equal(bad.statusCode, 400);
});

test('day-plan: a weekday morning checklist appears Mon, not Sun; completion shows as done', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chores',
    payload: {
      title: 'Get dressed',
      icon: '👕',
      frequency: 'daily',
      days: WEEKDAYS,
      routine: 'morning',
      assignedTo: memberId,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  const chore = res.json() as { id: string; days: number; routine: string };
  assert.equal(chore.days, WEEKDAYS);
  assert.equal(chore.routine, 'morning');

  const mine = (p: Plan) => p.members.find((m) => m.id === memberId)!;
  assert.deepEqual(mine(await plan(SUNDAY)).checklists.morning, []);
  const mon = mine(await plan(MONDAY)).checklists.morning;
  assert.equal(mon.length, 1);
  assert.equal(mon[0].done, false);

  await app.inject({
    method: 'POST',
    url: `/api/chores/${chore.id}/complete`,
    payload: { date: MONDAY },
  });
  assert.equal(mine(await plan(MONDAY)).checklists.morning[0].done, true);

  // The wall's chore board uses the same day rule.
  const board = await app.inject({ method: 'GET', url: `/api/chore-board?date=${SUNDAY}` });
  const boardMember = (board.json() as { members: Array<{ id: string; chores: unknown[] }> }).members.find(
    (m) => m.id === memberId
  )!;
  assert.equal(boardMember.chores.length, 0);
});

test('chores: switching a weekday chore to weekly clears its day mask', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chores',
    payload: { title: 'Shoes', icon: '👟', frequency: 'daily', days: WEEKDAYS, assignedTo: memberId },
  });
  const id = (res.json() as { id: string }).id;
  const upd = await app.inject({
    method: 'PUT',
    url: `/api/chores/${id}`,
    payload: { frequency: 'weekly', dayOfWeek: 1 },
  });
  assert.equal(upd.statusCode, 200, upd.body);
  assert.equal((upd.json() as { days: number | null }).days, null);
});

test('day-plan: routines filtered by day and converted from Brisbane time to UTC', async () => {
  const weekdayBath = await app.inject({
    method: 'POST',
    url: '/api/routines',
    payload: { kind: 'bath', time: '18:00', days: WEEKDAYS },
  });
  const id = (weekdayBath.json() as { id: string }).id;

  const mon = await plan(MONDAY);
  const bath = mon.routines.find((r) => r.id === id);
  assert.ok(bath);
  assert.equal(bath!.at, '2026-11-16T08:00:00Z'); // 18:00 AEST = 08:00Z

  const sun = await plan(SUNDAY);
  assert.equal(sun.routines.find((r) => r.id === id), undefined);
});

test('day-plan: dinner meal and the latest dinner call', async () => {
  const date = todayBrisbane();
  await app.inject({ method: 'PUT', url: `/api/dinners/${date}`, payload: { meal: 'Spaghetti' } });

  pokes = [];
  const call = await app.inject({ method: 'POST', url: '/api/dinner-calls' });
  assert.equal(call.statusCode, 201);
  const body = call.json() as { id: string; calledAt: string };
  assert.ok(pokes.some((p) => p.kind === 'dinner-call'));

  const p = await plan();
  assert.equal(p.date, date);
  assert.deepEqual(p.dinner, { meal: 'Spaghetti' });
  assert.equal(p.dinnerCall?.id, body.id);

  // A different day doesn't inherit today's call.
  assert.equal((await plan(SUNDAY)).dinnerCall, null);
});

test('day-plan rejects a malformed date', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/day-plan?date=17-11-2026' });
  assert.equal(res.statusCode, 400);
});

test('routine settings: defaults, partial update, validation, and in the day plan', async () => {
  const get = await app.inject({ method: 'GET', url: '/api/routine-settings' });
  assert.equal(get.statusCode, 200);
  const s = get.json() as Record<string, unknown>;
  assert.equal(s.warnMinutes, 10);
  assert.equal(s.graceMinutes, 15);
  assert.equal(s.bathLocks, true);
  assert.equal(s.morningsOffUntil, null);

  pokes = [];
  const put = await app.inject({
    method: 'PUT',
    url: '/api/routine-settings',
    payload: { bathLocks: false, morningsOffUntil: MONDAY, lockEnds: '20:00' },
  });
  assert.equal(put.statusCode, 200, put.body);
  const u = put.json() as Record<string, unknown>;
  assert.equal(u.bathLocks, false);
  assert.equal(u.warnMinutes, 10); // untouched
  assert.ok(pokes.some((p) => p.kind === 'routines'));

  for (const payload of [{ warnMinutes: 61 }, { lockEnds: '24:00' }, { lockEnds: '8pm' }, { morningWindowMinutes: 10 }, {}]) {
    const bad = await app.inject({ method: 'PUT', url: '/api/routine-settings', payload });
    assert.equal(bad.statusCode, 400, JSON.stringify(payload));
  }

  type Extra = { morningsOff: boolean; settings: { lockEnds: string } };
  assert.equal(((await plan(SUNDAY)) as unknown as Extra).morningsOff, true); // on/before the date
  const tue = (await plan('2026-11-17')) as unknown as Extra;
  assert.equal(tue.morningsOff, false);
  assert.equal(tue.settings.lockEnds, '20:00');

  // Restore defaults for any later test
  await app.inject({
    method: 'PUT',
    url: '/api/routine-settings',
    payload: { morningsOffUntil: null, bathLocks: true, lockEnds: '05:00' },
  });
});
