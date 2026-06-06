import { getDb } from '../db';
import { nowIso } from '../util/time';

// 'matcher' = regex bypassed Haiku; 'llm' = Haiku produced the intent.
// Distinct from null (non-intent paths: blank STT, hallucination, STT
// exception) so hit-rate metrics aren't inflated by no-intent rows.
export type IntentSource = 'matcher' | 'llm';

export interface VoiceUtteranceInsert {
  id: string;
  transcript: string;
  intentJson: string | null;
  confidence: number | null;
  status: 'applied' | 'confirmed' | 'cancelled' | 'pending' | 'failed' | 'silent_low_conf';
  durationMs: number | null;
  error: string | null;
  source: IntentSource | null;
  intentName?: string | null;
  answer?: string | null;
  concern?: boolean | null;
}

export interface VoiceUtterance extends VoiceUtteranceInsert {
  createdAt: string;
}

export function insertUtterance(u: VoiceUtteranceInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO voice_utterances
      (id, created_at, transcript, intent_json, confidence, status, duration_ms, error, source,
       intent_name, answer, concern)
    VALUES (@id, @createdAt, @transcript, @intentJson, @confidence, @status, @durationMs, @error, @source,
            @intentName, @answer, @concern)
  `).run({
    ...u,
    createdAt: nowIso(),
    intentName: u.intentName ?? null,
    answer: u.answer ?? null,
    // SQLite stores boolean as integer; null stays null. Don't write `false ? 0 : null`
    // — `false` collapses incorrectly; use explicit comparison.
    concern: u.concern == null ? null : (u.concern ? 1 : 0),
  });
}

export function listUtterances(opts: { limit: number }): VoiceUtterance[] {
  const rows = getDb().prepare(`
    SELECT id, created_at AS createdAt, transcript, intent_json AS intentJson,
           confidence, status, duration_ms AS durationMs, error, source,
           intent_name AS intentName, answer, concern
    FROM voice_utterances
    ORDER BY created_at DESC
    LIMIT ?
  `).all(opts.limit) as Array<Omit<VoiceUtterance, 'concern'> & { concern: number | null }>;
  // SQLite stores booleans as INTEGER (0/1, NULL = unset). Normalise at the
  // repo boundary so consumers can treat `concern` as `boolean | null` per
  // the interface contract.
  return rows.map(r => ({ ...r, concern: r.concern == null ? null : r.concern !== 0 }));
}
