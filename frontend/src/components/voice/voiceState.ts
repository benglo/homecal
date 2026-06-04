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
      return {
        kind: 'confirming',
        utterance_id: action.utterance_id ?? '?',
        intent: action.intent!,
        transcript: action.transcript ?? '',
      };
    case 'applied':
      return { kind: 'applied', utterance_id: action.utterance_id ?? '?', intent: action.intent! };
    case 'failed':
      return { kind: 'failed', utterance_id: action.utterance_id ?? '?', reason: action.reason ?? 'unknown' };
  }
}
