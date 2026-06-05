import { getDb } from '../db';
import { nowIso } from '../util/time';

export interface VoiceUtteranceInsert {
  id: string;
  transcript: string;
  intentJson: string | null;
  confidence: number | null;
  status: 'applied' | 'confirmed' | 'cancelled' | 'pending' | 'failed' | 'silent_low_conf';
  durationMs: number | null;
  error: string | null;
  // 'matcher' = regex bypassed Haiku; 'llm' = Haiku produced the intent.
  // null for non-intent paths (blank STT, hallucination, STT exception).
  source: 'matcher' | 'llm' | null;
}

export interface VoiceUtterance extends VoiceUtteranceInsert {
  createdAt: string;
}

export function insertUtterance(u: VoiceUtteranceInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO voice_utterances
      (id, created_at, transcript, intent_json, confidence, status, duration_ms, error, source)
    VALUES (@id, @createdAt, @transcript, @intentJson, @confidence, @status, @durationMs, @error, @source)
  `).run({ ...u, createdAt: nowIso() });
}

export function listUtterances(opts: { limit: number }): VoiceUtterance[] {
  return getDb().prepare(`
    SELECT id, created_at AS createdAt, transcript, intent_json AS intentJson,
           confidence, status, duration_ms AS durationMs, error, source
    FROM voice_utterances
    ORDER BY created_at DESC
    LIMIT ?
  `).all(opts.limit) as VoiceUtterance[];
}
