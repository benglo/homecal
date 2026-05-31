import { getDb } from '../db';
import { isoUtc } from '../util/time';
import { httpError } from '../util/errors';
import type { Dinner } from '../model/types';

interface Row {
  date: string;
  meal: string;
  updated_at: string;
}
const toDinner = (r: Row): Dinner => ({ date: r.date, meal: r.meal, updatedAt: r.updated_at });

export function listDinners(startDate: string, endDate: string): Dinner[] {
  return (
    getDb()
      .prepare('SELECT * FROM dinners WHERE date >= ? AND date <= ? ORDER BY date')
      .all(startDate, endDate) as Row[]
  ).map(toDinner);
}

export function setDinner(date: string, meal: string): Dinner {
  const db = getDb();
  db.prepare(
    `INSERT INTO dinners (date, meal, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET meal=excluded.meal, updated_at=excluded.updated_at`
  ).run(date, meal, isoUtc(new Date()));
  return toDinner(db.prepare('SELECT * FROM dinners WHERE date = ?').get(date) as Row);
}

export function deleteDinner(date: string): void {
  const info = getDb().prepare('DELETE FROM dinners WHERE date = ?').run(date);
  if (info.changes === 0) throw httpError(404, 'NOT_FOUND', 'No dinner set for that date');
}
