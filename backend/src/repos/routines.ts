import { getDb } from '../db';
import { newId } from '../util/ids';
import { nowIso } from '../util/time';
import { httpError } from '../util/errors';
import { familyMemberExists } from './familyMembers';
import type { Routine, RoutineKind } from '../model/types';
import type { RoutineCreate, RoutineUpdate } from '../schemas';

interface Row {
  id: string;
  kind: string;
  time: string;
  days: number;
  member_id: string | null;
  updated_at: string;
}

const toRoutine = (r: Row): Routine => ({
  id: r.id,
  kind: r.kind as RoutineKind,
  time: r.time,
  days: r.days,
  memberId: r.member_id,
  updatedAt: r.updated_at,
});

export function listRoutines(): Routine[] {
  return (
    getDb().prepare('SELECT * FROM routines ORDER BY time, kind').all() as Row[]
  ).map(toRoutine);
}

export function getRoutine(id: string): Routine | null {
  const r = getDb().prepare('SELECT * FROM routines WHERE id = ?').get(id) as Row | undefined;
  return r ? toRoutine(r) : null;
}

function assertMember(memberId: string | null): void {
  if (memberId != null && !familyMemberExists(getDb(), memberId)) {
    throw httpError(400, 'INVALID_MEMBER', 'Family member does not exist');
  }
}

export function createRoutine(input: RoutineCreate): Routine {
  assertMember(input.memberId);
  const id = newId();
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO routines (id, kind, time, days, member_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.kind, input.time, input.days, input.memberId, ts, ts);
  return getRoutine(id)!;
}

export function updateRoutine(id: string, patch: RoutineUpdate): Routine {
  const existing = getRoutine(id);
  if (!existing) throw httpError(404, 'NOT_FOUND', 'Routine not found');
  const next = {
    kind: patch.kind ?? existing.kind,
    time: patch.time ?? existing.time,
    days: patch.days ?? existing.days,
    memberId: patch.memberId !== undefined ? patch.memberId : existing.memberId,
  };
  assertMember(next.memberId);
  getDb()
    .prepare('UPDATE routines SET kind=?, time=?, days=?, member_id=?, updated_at=? WHERE id=?')
    .run(next.kind, next.time, next.days, next.memberId, nowIso(), id);
  return getRoutine(id)!;
}

export function deleteRoutine(id: string): void {
  const info = getDb().prepare('DELETE FROM routines WHERE id = ?').run(id);
  if (info.changes === 0) throw httpError(404, 'NOT_FOUND', 'Routine not found');
}
