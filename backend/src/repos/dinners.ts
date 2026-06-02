import { getDb } from '../db';
import { isoUtc } from '../util/time';
import { httpError } from '../util/errors';
import type { Dinner, DinnerSuggestion } from '../model/types';

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

export function listAllDinners(): Dinner[] {
  return (
    getDb().prepare('SELECT * FROM dinners ORDER BY date').all() as Row[]
  ).map(toDinner);
}

interface SuggestionRow {
  meal: string;
  count: number;
  last_used: string;
}

/** Distinct meal names ranked for typeahead, deduped case-insensitively.
 *  Canonical casing = the spelling from the most recent usage (ties broken
 *  by ASCII order of `meal` so the output is fully deterministic).
 *  Uses SQLite window functions (≥3.25 — bundled with better-sqlite3).
 *
 *  Caveat: SQLite's default LOWER() is ASCII-only — "CAFÉ" and "café" are
 *  NOT collapsed. Accept this for a small family table; revisit only if a
 *  unicode-heavy meal vocabulary becomes a real issue. */
export function listSuggestions(limit: number): DinnerSuggestion[] {
  const rows = getDb()
    .prepare(
      `SELECT meal, count, last_used
         FROM (
           SELECT
             meal,
             COUNT(*)  OVER (PARTITION BY LOWER(meal)) AS count,
             MAX(updated_at) OVER (PARTITION BY LOWER(meal)) AS last_used,
             ROW_NUMBER() OVER (
               PARTITION BY LOWER(meal)
               ORDER BY updated_at DESC, meal
             ) AS rn
           FROM dinners
         )
        WHERE rn = 1
        ORDER BY count DESC, last_used DESC, meal
        LIMIT ?`
    )
    .all(limit) as SuggestionRow[];
  return rows.map((r) => ({ meal: r.meal, count: r.count, lastUsed: r.last_used }));
}
