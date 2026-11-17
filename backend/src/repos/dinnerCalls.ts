import { getDb } from '../db';
import { newId } from '../util/ids';
import { isoUtc, DAY_MS } from '../util/time';
import type { DinnerCall } from '../model/types';

/** Calls are transient signals; a week of history is plenty for debugging. */
const KEEP_MS = 7 * DAY_MS;

export function callDinner(now: Date = new Date()): DinnerCall {
  const db = getDb();
  const call: DinnerCall = { id: newId(), calledAt: isoUtc(now) };
  db.prepare('INSERT INTO dinner_calls (id, called_at) VALUES (?, ?)').run(call.id, call.calledAt);
  db.prepare('DELETE FROM dinner_calls WHERE called_at < ?').run(
    isoUtc(new Date(now.getTime() - KEEP_MS))
  );
  return call;
}

/** Latest call with `fromIso <= calledAt < toIso`, or null. */
export function latestDinnerCall(fromIso: string, toIso: string): DinnerCall | null {
  const r = getDb()
    .prepare(
      `SELECT id, called_at FROM dinner_calls
       WHERE called_at >= ? AND called_at < ?
       ORDER BY called_at DESC LIMIT 1`
    )
    .get(fromIso, toIso) as { id: string; called_at: string } | undefined;
  return r ? { id: r.id, calledAt: r.called_at } : null;
}
