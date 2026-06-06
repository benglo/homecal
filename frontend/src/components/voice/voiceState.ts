import type { ParsedIntent, VoiceOverlayKind } from '../../core/model/types';

export type OverlayState =
  | { kind: 'idle' }
  | { kind: 'listening'; utterance_id: string; vu: number }
  | { kind: 'thinking'; utterance_id: string; transcript_partial: string }
  | { kind: 'confirming'; utterance_id: string; intent: ParsedIntent; transcript: string }
  | { kind: 'applied'; utterance_id: string; intent: ParsedIntent }
  | { kind: 'failed'; utterance_id: string; reason: string }
  | { kind: 'mic_offline' }
  | { kind: 'voice_offline' };

export type OverlayAction =
  | {
      type: 'sse';
      kind: VoiceOverlayKind;
      utterance_id?: string;
      payload?: unknown;
      vu?: number;
      transcript_partial?: string;
      transcript?: string;
      intent?: ParsedIntent;
      reason?: string;
    }
  | { type: 'auto-fade' }
  | { type: 'cancel' };

const VOICE_KINDS: ReadonlySet<VoiceOverlayKind> = new Set([
  'idle',
  'listening',
  'thinking',
  'confirming',
  'applied',
  'failed',
  'mic_offline',
  'voice_offline',
]);

/**
 * Translate a raw SSE poke payload into a typed `OverlayAction`.
 *
 * The Pi posts `{ utterance_id, kind, payload }` to `/api/voice/state`;
 * the server fans it out via SSE. This parser is the trust boundary —
 * it rejects unknown kinds (e.g. `mute_changed`, which is consumed by
 * the voice-status query invalidation, not the overlay), bad payload
 * shapes, and missing required fields for the discriminated state
 * (e.g. `confirming` without an `intent`).
 *
 * Returns `null` for anything the reducer would refuse to render —
 * callers should simply skip dispatching.
 */
export function pokeToAction(raw: unknown): OverlayAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== 'string') return null;
  if (!VOICE_KINDS.has(kind as VoiceOverlayKind)) return null;

  const utteranceId = typeof obj.utterance_id === 'string' ? obj.utterance_id : undefined;
  const payload = obj.payload && typeof obj.payload === 'object' ? (obj.payload as Record<string, unknown>) : {};

  const action: OverlayAction = {
    type: 'sse',
    kind: kind as VoiceOverlayKind,
    utterance_id: utteranceId,
    payload: obj.payload,
    vu: typeof payload.vu === 'number' && Number.isFinite(payload.vu) ? payload.vu : undefined,
    transcript_partial: typeof payload.transcript_partial === 'string' ? payload.transcript_partial : undefined,
    transcript: typeof payload.transcript === 'string' ? payload.transcript : undefined,
    intent: isParsedIntent(payload.intent) ? payload.intent : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : undefined,
  };

  // `confirming` and `applied` require an intent; reject the action if missing
  // so the reducer never has to non-null-assert.
  if ((kind === 'confirming' || kind === 'applied') && !action.intent) return null;
  if (kind === 'confirming' && action.transcript === undefined) return null;
  return action;
}

function isParsedIntent(v: unknown): v is ParsedIntent {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.intent !== 'string') return false;
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence)) return false;
  switch (o.intent) {
    case 'dinner_set':
      return typeof o.date === 'string' && typeof o.meal === 'string';
    case 'chore_complete':
      return typeof o.person === 'string' && typeof o.chore === 'string';
    case 'query_dinner':
    case 'query_agenda':
      return typeof o.date === 'string';
    case 'timer_set':
    case 'timer_extend':
      return typeof o.duration_sec === 'number' && (o.label === null || typeof o.label === 'string');
    case 'timer_query':
    case 'timer_cancel':
      return o.label === null || typeof o.label === 'string';
    case 'unknown':
      return typeof o.reason === 'string';
    default:
      return false;
  }
}

export function initialOverlay(): OverlayState {
  return { kind: 'idle' };
}

export function reduceOverlay(state: OverlayState, action: OverlayAction): OverlayState {
  if (action.type === 'auto-fade' || action.type === 'cancel') return { kind: 'idle' };
  if (action.type !== 'sse') return state;

  switch (action.kind) {
    case 'idle':
      return { kind: 'idle' };
    case 'mic_offline':
      return { kind: 'mic_offline' };
    case 'voice_offline':
      return { kind: 'voice_offline' };
    case 'listening':
      return { kind: 'listening', utterance_id: action.utterance_id ?? '?', vu: action.vu ?? 0 };
    case 'thinking':
      return {
        kind: 'thinking',
        utterance_id: action.utterance_id ?? '?',
        transcript_partial: action.transcript_partial ?? '',
      };
    case 'confirming':
      // `intent` is guaranteed present by `pokeToAction`; bare callers must respect that.
      if (!action.intent) return state;
      return {
        kind: 'confirming',
        utterance_id: action.utterance_id ?? '?',
        intent: action.intent,
        transcript: action.transcript ?? '',
      };
    case 'applied':
      if (!action.intent) return state;
      return { kind: 'applied', utterance_id: action.utterance_id ?? '?', intent: action.intent };
    case 'failed':
      return { kind: 'failed', utterance_id: action.utterance_id ?? '?', reason: action.reason ?? 'unknown' };
    default:
      // Unknown kind from the wire — preserve current state, never return undefined.
      return state;
  }
}
