import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { newId } from '../util/ids';
import { isoUtc } from '../util/time';
import { httpError } from '../util/errors';
import type { Category } from '../model/types';
import type { CategoryCreate, CategoryUpdate } from '../schemas';

interface Row {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  updated_at: string;
}
const toCategory = (r: Row): Category => ({
  id: r.id,
  name: r.name,
  color: r.color,
  icon: r.icon,
  updatedAt: r.updated_at,
});

const now = () => isoUtc(new Date());

export function listCategories(): Category[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM categories ORDER BY name').all() as Row[]).map(toCategory);
}

export function getCategory(id: string): Category | null {
  const r = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id) as Row | undefined;
  return r ? toCategory(r) : null;
}

export function createCategory(input: CategoryCreate): Category {
  const db = getDb();
  const id = newId();
  const ts = now();
  try {
    db.prepare(
      `INSERT INTO categories (id, name, color, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.color, input.icon ?? null, ts, ts);
  } catch (e) {
    throw uniqueOr(e, 'A category with that name already exists');
  }
  return getCategory(id)!;
}

export function updateCategory(id: string, patch: CategoryUpdate): Category {
  const db = getDb();
  const existing = getCategory(id);
  if (!existing) throw httpError(404, 'NOT_FOUND', 'Category not found');
  const next = {
    name: patch.name ?? existing.name,
    color: patch.color ?? existing.color,
    icon: patch.icon ?? existing.icon,
  };
  try {
    db.prepare('UPDATE categories SET name=?, color=?, icon=?, updated_at=? WHERE id=?').run(
      next.name,
      next.color,
      next.icon,
      now(),
      id
    );
  } catch (e) {
    throw uniqueOr(e, 'A category with that name already exists');
  }
  return getCategory(id)!;
}

export function deleteCategory(id: string): void {
  const db = getDb();
  if (!getCategory(id)) throw httpError(404, 'NOT_FOUND', 'Category not found');
  const refs = (db.prepare('SELECT count(*) c FROM events WHERE category_id = ?').get(id) as { c: number }).c;
  if (refs > 0) {
    throw httpError(409, 'CATEGORY_IN_USE', `Category has ${refs} event(s); move or delete them first`);
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

function uniqueOr(e: unknown, msg: string): Error {
  if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
    return httpError(409, 'DUPLICATE_NAME', msg);
  }
  return e as Error;
}

export function categoryExists(db: Database.Database, id: string): boolean {
  return !!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id);
}
