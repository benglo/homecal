import { getDb } from '../db';
import { isoUtc, nowIso } from '../util/time';
import { newId } from '../util/ids';
import { httpError } from '../util/errors';
import type { Timer } from '../model/types';

interface Row {
  id: string;
  label: string | null;
  duration_sec: number;
  started_at: string;
  expires_at: string;
  acknowledged_at: string | null;
  updated_at: string;
}

const toTimer = (r: Row): Timer => ({
  id: r.id,
  label: r.label,
  durationSec: r.duration_sec,
  startedAt: r.started_at,
  expiresAt: r.expires_at,
  acknowledgedAt: r.acknowledged_at,
  updatedAt: r.updated_at,
});

function getRow(id: string): Row | null {
  const row = getDb().prepare('SELECT * FROM timers WHERE id = ?').get(id) as Row | undefined;
  return row ?? null;
}

function requireRow(id: string): Row {
  const row = getRow(id);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Timer not found');
  return row;
}

export interface CreateTimerInput {
  label: string | null;
  durationSec: number;
}

export function createTimer(input: CreateTimerInput, now: Date = new Date()): Timer {
  const id = newId();
  const startedAt = isoUtc(now);
  const expiresAt = isoUtc(new Date(now.getTime() + input.durationSec * 1000));
  getDb()
    .prepare(
      `INSERT INTO timers (id, label, duration_sec, started_at, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.label, input.durationSec, startedAt, expiresAt, startedAt);
  return toTimer(requireRow(id));
}

/** Active = not yet acknowledged. Ordered earliest-expiring first so the
 *  wall's chip stack reads naturally and findTimerByLabel(null) picks the
 *  most-imminent one when only one exists. */
export function listActiveTimers(): Timer[] {
  return (
    getDb()
      .prepare('SELECT * FROM timers WHERE acknowledged_at IS NULL ORDER BY expires_at ASC')
      .all() as Row[]
  ).map(toTimer);
}

/** Label lookup for voice intents. NULL label means "the timer" — only
 *  resolves when exactly one active timer exists (otherwise ambiguous). */
export function findTimerByLabel(label: string | null): Timer | null {
  const db = getDb();
  if (label === null) {
    const rows = db
      .prepare('SELECT * FROM timers WHERE acknowledged_at IS NULL LIMIT 2')
      .all() as Row[];
    return rows.length === 1 ? toTimer(rows[0]) : null;
  }
  // Most-recently-started match — if a family member sets two "pasta" timers
  // the second is the one they're talking about.
  const row = db
    .prepare(
      `SELECT * FROM timers
        WHERE acknowledged_at IS NULL AND LOWER(label) = LOWER(?)
        ORDER BY started_at DESC LIMIT 1`,
    )
    .get(label) as Row | undefined;
  return row ? toTimer(row) : null;
}

export function extendTimer(id: string, addSec: number): Timer {
  const row = requireRow(id);
  const newDuration = row.duration_sec + addSec;
  const newExpires = isoUtc(new Date(Date.parse(row.expires_at) + addSec * 1000));
  getDb()
    .prepare(
      `UPDATE timers SET duration_sec = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(newDuration, newExpires, nowIso(), id);
  return toTimer(requireRow(id));
}

export function cancelTimer(id: string): void {
  const info = getDb().prepare('DELETE FROM timers WHERE id = ?').run(id);
  if (info.changes === 0) throw httpError(404, 'NOT_FOUND', 'Timer not found');
}

/** Idempotent — once acknowledged, repeated calls keep the original time. */
export function acknowledgeTimer(id: string, at: Date = new Date()): Timer {
  const row = requireRow(id);
  if (row.acknowledged_at === null) {
    const ackIso = isoUtc(at);
    getDb()
      .prepare('UPDATE timers SET acknowledged_at = ?, updated_at = ? WHERE id = ?')
      .run(ackIso, ackIso, id);
  }
  return toTimer(requireRow(id));
}
