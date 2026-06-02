import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { newId } from '../util/ids';
import { nowIso } from '../util/time';
import { httpError, uniqueOr } from '../util/errors';
import type { FamilyMember } from '../model/types';
import type { FamilyMemberCreate } from '../schemas';

interface Row {
  id: string;
  name: string;
  icon: string;
  updated_at: string;
}

const toMember = (r: Row): FamilyMember => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  updatedAt: r.updated_at,
});

export function listFamilyMembers(): FamilyMember[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM family_members ORDER BY name').all() as Row[]).map(toMember);
}

export function getFamilyMember(id: string): FamilyMember | null {
  const r = getDb().prepare('SELECT * FROM family_members WHERE id = ?').get(id) as Row | undefined;
  return r ? toMember(r) : null;
}

export function createFamilyMember(input: FamilyMemberCreate): FamilyMember {
  const db = getDb();
  const id = newId();
  const ts = nowIso();
  try {
    db.prepare(
      `INSERT INTO family_members (id, name, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, input.name, input.icon, ts, ts);
  } catch (e) {
    throw uniqueOr(e, 'A family member with that name already exists');
  }
  return getFamilyMember(id)!;
}

export function updateFamilyMember(id: string, input: FamilyMemberCreate): FamilyMember {
  const db = getDb();
  if (!getFamilyMember(id)) throw httpError(404, 'NOT_FOUND', 'Family member not found');
  try {
    db.prepare('UPDATE family_members SET name=?, icon=?, updated_at=? WHERE id=?').run(
      input.name,
      input.icon,
      nowIso(),
      id
    );
  } catch (e) {
    throw uniqueOr(e, 'A family member with that name already exists');
  }
  return getFamilyMember(id)!;
}

export function deleteFamilyMember(id: string): void {
  const db = getDb();
  if (!getFamilyMember(id)) throw httpError(404, 'NOT_FOUND', 'Family member not found');
  db.prepare('DELETE FROM family_members WHERE id = ?').run(id);
}

export function familyMemberExists(db: Database.Database, id: string): boolean {
  return !!db.prepare('SELECT 1 FROM family_members WHERE id = ?').get(id);
}
