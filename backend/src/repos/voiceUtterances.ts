import { getDb } from '../db';
import { nowIso } from '../util/time';

// 'matcher' = regex bypassed Haiku; 'llm' = Haiku produced the intent.
// Distinct from null (non-intent paths: blank STT, hallucination, STT
// exception) so hit-rate metrics aren't inflated by no-intent rows.
export type IntentSource = 'matcher' | 'llm';

export type TtsProvider = 'kokoro_lan' | 'openrouter' | 'clip' | 'none';

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
  ttsProvider?: TtsProvider | null;
  ttsLatencyMs?: number | null;
}

export interface VoiceUtterance extends VoiceUtteranceInsert {
  createdAt: string;
}

export function insertUtterance(u: VoiceUtteranceInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO voice_utterances
      (id, created_at, transcript, intent_json, confidence, status, duration_ms, error, source,
       intent_name, answer, concern, tts_provider, tts_latency_ms)
    VALUES (@id, @createdAt, @transcript, @intentJson, @confidence, @status, @durationMs, @error, @source,
            @intentName, @answer, @concern, @ttsProvider, @ttsLatencyMs)
  `).run({
    ...u,
    createdAt: nowIso(),
    intentName: u.intentName ?? null,
    answer: u.answer ?? null,
    // SQLite stores boolean as integer; null stays null. Don't write `false ? 0 : null`
    // — `false` collapses incorrectly; use explicit comparison.
    concern: u.concern == null ? null : (u.concern ? 1 : 0),
    ttsProvider: u.ttsProvider ?? null,
    ttsLatencyMs: u.ttsLatencyMs ?? null,
  });
}

export function listUtterances(opts: { limit: number }): VoiceUtterance[] {
  const rows = getDb().prepare(`
    SELECT id, created_at AS createdAt, transcript, intent_json AS intentJson,
           confidence, status, duration_ms AS durationMs, error, source,
           intent_name AS intentName, answer, concern,
           tts_provider AS ttsProvider, tts_latency_ms AS ttsLatencyMs
    FROM voice_utterances
    ORDER BY created_at DESC
    LIMIT ?
  `).all(opts.limit) as Array<Omit<VoiceUtterance, 'concern'> & { concern: number | null }>;
  // SQLite stores booleans as INTEGER (0/1, NULL = unset). Normalise at the
  // repo boundary so consumers can treat `concern` as `boolean | null` per
  // the interface contract.
  return rows.map(r => ({ ...r, concern: r.concern == null ? null : r.concern !== 0 }));
}

export function getLastTtsProvider(): TtsProvider | null {
  const row = getDb().prepare(`
    SELECT tts_provider FROM voice_utterances
    WHERE tts_provider IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get() as { tts_provider: TtsProvider } | undefined;
  return row?.tts_provider ?? null;
}
