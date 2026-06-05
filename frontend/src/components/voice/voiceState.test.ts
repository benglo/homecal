import { describe, it, expect } from 'vitest';
import { reduceOverlay, initialOverlay, pokeToAction } from './voiceState';

describe('reduceOverlay', () => {
  it('starts idle', () => {
    expect(initialOverlay()).toEqual({ kind: 'idle' });
  });

  it('voice_offline overrides current utterance', () => {
    const s = reduceOverlay(
      { kind: 'thinking', utterance_id: 'u1', transcript_partial: '' },
      { type: 'sse', kind: 'voice_offline' },
    );
    expect(s).toEqual({ kind: 'voice_offline' });
  });

  it('listening → thinking → confirming → applied → idle', () => {
    let s = initialOverlay();
    s = reduceOverlay(s, { type: 'sse', kind: 'listening', utterance_id: 'u1', vu: 0 });
    expect(s.kind).toBe('listening');
    s = reduceOverlay(s, { type: 'sse', kind: 'thinking', utterance_id: 'u1', transcript_partial: 'hi' });
    expect(s.kind).toBe('thinking');
    s = reduceOverlay(s, {
      type: 'sse',
      kind: 'confirming',
      utterance_id: 'u1',
      intent: { intent: 'dinner_set', date: '2026-06-04', meal: 'tacos', confidence: 0.9 },
      transcript: 'tonight tacos',
    });
    expect(s.kind).toBe('confirming');
    s = reduceOverlay(s, {
      type: 'sse',
      kind: 'applied',
      utterance_id: 'u1',
      intent: { intent: 'dinner_set', date: '2026-06-04', meal: 'tacos', confidence: 0.9 },
    });
    expect(s.kind).toBe('applied');
    s = reduceOverlay(s, { type: 'auto-fade' });
    expect(s.kind).toBe('idle');
  });

  it('different utterance_id during confirming wins (latest)', () => {
    let s = reduceOverlay(initialOverlay(), {
      type: 'sse',
      kind: 'confirming',
      utterance_id: 'u1',
      intent: { intent: 'dinner_set', date: '2026-06-04', meal: 'tacos', confidence: 0.9 },
      transcript: 'first',
    });
    s = reduceOverlay(s, { type: 'sse', kind: 'listening', utterance_id: 'u2', vu: 0 });
    expect(s.kind).toBe('listening');
    if (s.kind === 'listening') expect(s.utterance_id).toBe('u2');
  });

  it('failed action carries the reason', () => {
    const s = reduceOverlay(initialOverlay(), {
      type: 'sse',
      kind: 'failed',
      utterance_id: 'u1',
      reason: 'stt_error',
    });
    expect(s.kind).toBe('failed');
    if (s.kind === 'failed') expect(s.reason).toBe('stt_error');
  });

  it('returns current state for unknown action kind (no crash on schema drift)', () => {
    const prev = { kind: 'listening', utterance_id: 'u1', vu: 0.5 } as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next = reduceOverlay(prev, { type: 'sse', kind: 'whatever_new_kind' as any });
    expect(next).toEqual(prev);
  });

  it('confirming without intent is rejected (preserves previous state)', () => {
    const prev = { kind: 'listening', utterance_id: 'u1', vu: 0 } as const;
    const next = reduceOverlay(prev, { type: 'sse', kind: 'confirming', utterance_id: 'u1' });
    expect(next).toEqual(prev);
  });

  it('applied without intent is rejected (preserves previous state)', () => {
    const prev = { kind: 'thinking', utterance_id: 'u1', transcript_partial: 'hi' } as const;
    const next = reduceOverlay(prev, { type: 'sse', kind: 'applied', utterance_id: 'u1' });
    expect(next).toEqual(prev);
  });

  it('cancel returns to idle', () => {
    const prev = {
      kind: 'confirming' as const,
      utterance_id: 'u1',
      intent: { intent: 'dinner_set' as const, date: '2026-06-04', meal: 'tacos', confidence: 0.9 },
      transcript: 't',
    };
    const next = reduceOverlay(prev, { type: 'cancel' });
    expect(next).toEqual({ kind: 'idle' });
  });
});

describe('pokeToAction', () => {
  it('returns null for non-object input', () => {
    expect(pokeToAction(null)).toBeNull();
    expect(pokeToAction(undefined)).toBeNull();
    expect(pokeToAction('hello')).toBeNull();
    expect(pokeToAction(42)).toBeNull();
  });

  it('returns null when kind is not a string', () => {
    expect(pokeToAction({ kind: 1 })).toBeNull();
    expect(pokeToAction({})).toBeNull();
  });

  it('returns null for mute_changed (consumed by query invalidation only)', () => {
    expect(pokeToAction({ kind: 'mute_changed', mute_until: null })).toBeNull();
  });

  it('returns null for unknown kinds (schema drift defence)', () => {
    expect(pokeToAction({ kind: 'whatever_new_kind' })).toBeNull();
  });

  it('rejects confirming without intent', () => {
    expect(
      pokeToAction({
        utterance_id: 'u1',
        kind: 'confirming',
        payload: { transcript: 'hi' },
      }),
    ).toBeNull();
  });

  it('rejects applied without intent', () => {
    expect(
      pokeToAction({
        utterance_id: 'u1',
        kind: 'applied',
        payload: {},
      }),
    ).toBeNull();
  });

  it('rejects confirming with malformed intent (missing field)', () => {
    expect(
      pokeToAction({
        utterance_id: 'u1',
        kind: 'confirming',
        payload: {
          intent: { intent: 'dinner_set', confidence: 0.9 }, // missing date+meal
          transcript: 'tacos',
        },
      }),
    ).toBeNull();
  });

  it('extracts listening payload (vu)', () => {
    const action = pokeToAction({
      utterance_id: 'u1',
      kind: 'listening',
      payload: { vu: 0.4 },
    });
    expect(action).toMatchObject({ type: 'sse', kind: 'listening', utterance_id: 'u1', vu: 0.4 });
  });

  it('extracts confirming payload (intent + transcript)', () => {
    const action = pokeToAction({
      utterance_id: 'u1',
      kind: 'confirming',
      payload: {
        intent: { intent: 'dinner_set', date: '2026-06-05', meal: 'tacos', confidence: 0.92 },
        transcript: 'tonight tacos',
      },
    });
    expect(action).not.toBeNull();
    if (action && action.type === 'sse') {
      expect(action.kind).toBe('confirming');
      expect(action.intent?.intent).toBe('dinner_set');
      expect(action.transcript).toBe('tonight tacos');
    }
  });

  it('drops NaN vu values', () => {
    const action = pokeToAction({ utterance_id: 'u1', kind: 'listening', payload: { vu: NaN } });
    expect(action).not.toBeNull();
    if (action && action.type === 'sse') expect(action.vu).toBeUndefined();
  });

  it('accepts states with no payload (idle / mic_offline / voice_offline)', () => {
    const mic = pokeToAction({ kind: 'mic_offline' });
    const voice = pokeToAction({ kind: 'voice_offline' });
    const idle = pokeToAction({ kind: 'idle' });
    expect(mic?.type === 'sse' && mic.kind).toBe('mic_offline');
    expect(voice?.type === 'sse' && voice.kind).toBe('voice_offline');
    expect(idle?.type === 'sse' && idle.kind).toBe('idle');
  });
});
