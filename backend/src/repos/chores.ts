import { getDb } from '../db';
import { newId } from '../util/ids';
import { isoUtc } from '../util/time';
import { httpError } from '../util/errors';
import { familyMemberExists } from './familyMembers';
import type {
  Chore,
  ChoreCompletion,
  ChoreBoard,
  BoardMember,
  BoardChore,
  ChoreFrequency,
} from '../model/types';
import type { ChoreCreate, ChoreUpdate } from '../schemas';

interface ChoreRow {
  id: string;
  title: string;
  icon: string;
  stars: number;
  frequency: string;
  day_of_week: number | null;
  assigned_to: string;
  position: number;
  updated_at: string;
}

const toChore = (r: ChoreRow): Chore => ({
  id: r.id,
  title: r.title,
  icon: r.icon,
  stars: r.stars,
  frequency: r.frequency as ChoreFrequency,
  dayOfWeek: r.day_of_week,
  assignedTo: r.assigned_to,
  position: r.position,
  updatedAt: r.updated_at,
});

const now = () => isoUtc(new Date());

export function listChores(): Chore[] {
  const db = getDb();
  return (
    db
      .prepare('SELECT * FROM chores ORDER BY assigned_to, position, title')
      .all() as ChoreRow[]
  ).map(toChore);
}

export function getChore(id: string): Chore | null {
  const r = getDb()
    .prepare('SELECT * FROM chores WHERE id = ?')
    .get(id) as ChoreRow | undefined;
  return r ? toChore(r) : null;
}

export function createChore(input: ChoreCreate): Chore {
  const db = getDb();
  if (!familyMemberExists(db, input.assignedTo)) {
    throw httpError(400, 'INVALID_MEMBER', 'Family member does not exist');
  }
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.icon,
    input.stars,
    input.frequency,
    input.dayOfWeek ?? null,
    input.assignedTo,
    input.position,
    ts,
    ts
  );
  return getChore(id)!;
}

export function updateChore(id: string, patch: ChoreUpdate): Chore {
  const db = getDb();
  const existing = getChore(id);
  if (!existing) throw httpError(404, 'NOT_FOUND', 'Chore not found');
  if (patch.assignedTo && !familyMemberExists(db, patch.assignedTo)) {
    throw httpError(400, 'INVALID_MEMBER', 'Family member does not exist');
  }
  const next = {
    title: patch.title ?? existing.title,
    icon: patch.icon ?? existing.icon,
    stars: patch.stars ?? existing.stars,
    frequency: patch.frequency ?? existing.frequency,
    dayOfWeek:
      patch.dayOfWeek !== undefined ? patch.dayOfWeek : existing.dayOfWeek,
    assignedTo: patch.assignedTo ?? existing.assignedTo,
    position: patch.position ?? existing.position,
  };
  db.prepare(
    `UPDATE chores SET title=?, icon=?, stars=?, frequency=?, day_of_week=?, assigned_to=?, position=?, updated_at=?
     WHERE id=?`
  ).run(
    next.title,
    next.icon,
    next.stars,
    next.frequency,
    next.dayOfWeek,
    next.assignedTo,
    next.position,
    now(),
    id
  );
  return getChore(id)!;
}

export function deleteChore(id: string): void {
  const db = getDb();
  if (!getChore(id)) throw httpError(404, 'NOT_FOUND', 'Chore not found');
  db.prepare('DELETE FROM chores WHERE id = ?').run(id);
}

export function completeChore(
  choreId: string,
  date: string
): { completion: ChoreCompletion; created: boolean } {
  const db = getDb();
  if (!getChore(choreId)) throw httpError(404, 'NOT_FOUND', 'Chore not found');
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO chore_completions (chore_id, completed_date, completed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(chore_id, completed_date) DO NOTHING`
    )
    .run(choreId, date, ts);
  const row = db
    .prepare(
      'SELECT chore_id, completed_date, completed_at FROM chore_completions WHERE chore_id = ? AND completed_date = ?'
    )
    .get(choreId, date) as {
    chore_id: string;
    completed_date: string;
    completed_at: string;
  };
  return {
    completion: {
      choreId: row.chore_id,
      completedDate: row.completed_date,
      completedAt: row.completed_at,
    },
    created: info.changes > 0,
  };
}

export function uncompleteChore(choreId: string, date: string): void {
  const info = getDb()
    .prepare(
      'DELETE FROM chore_completions WHERE chore_id = ? AND completed_date = ?'
    )
    .run(choreId, date);
  if (info.changes === 0)
    throw httpError(404, 'NOT_FOUND', 'Completion not found');
}

export function getBoard(date: string): ChoreBoard {
  const db = getDb();

  const members = db
    .prepare('SELECT id, name, icon FROM family_members ORDER BY name')
    .all() as Array<{ id: string; name: string; icon: string }>;

  const dueChores = db
    .prepare(
      `SELECT c.*, cc.completed_date, cc.completed_at
       FROM chores c
       LEFT JOIN chore_completions cc ON cc.chore_id = c.id AND cc.completed_date = ?
       WHERE c.frequency = 'daily'
          OR (c.frequency = 'weekly' AND c.day_of_week = CAST(strftime('%w', ?) AS INTEGER))
       ORDER BY c.assigned_to, c.position, c.title`
    )
    .all(date, date) as Array<
    ChoreRow & { completed_date: string | null; completed_at: string | null }
  >;

  const starTotals = new Map<string, number>();
  const starRows = db
    .prepare(
      `SELECT c.assigned_to, COALESCE(SUM(c.stars), 0) as total
       FROM chore_completions cc
       JOIN chores c ON cc.chore_id = c.id
       GROUP BY c.assigned_to`
    )
    .all() as Array<{ assigned_to: string; total: number }>;
  for (const r of starRows) starTotals.set(r.assigned_to, r.total);

  const choresByMember = new Map<string, BoardChore[]>();
  for (const r of dueChores) {
    const list = choresByMember.get(r.assigned_to) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      icon: r.icon,
      stars: r.stars,
      completed: r.completed_date !== null,
      completedAt: r.completed_at,
    });
    choresByMember.set(r.assigned_to, list);
  }

  const boardMembers: BoardMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    icon: m.icon,
    totalStars: starTotals.get(m.id) ?? 0,
    chores: choresByMember.get(m.id) ?? [],
  }));

  return { date, members: boardMembers };
}
