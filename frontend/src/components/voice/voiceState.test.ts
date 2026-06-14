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

  // Each new intent variant must round-trip through pokeToAction or the wall
  // chip hangs on 'thinking' after the Pi posts applied — the trust boundary
  // silently rejects unknown intent shapes.
  it.each([
    // timer_* canonical regression for trust-boundary validation
    { intent: 'timer_set', duration_sec: 300, label: 'pasta', confidence: 1.0 },
    { intent: 'timer_set', duration_sec: 60, label: null, confidence: 1.0 },
    { intent: 'timer_query', label: null, confidence: 1.0 },
    { intent: 'timer_cancel', label: 'pasta', confidence: 1.0 },
    { intent: 'timer_extend', duration_sec: 120, label: null, confidence: 1.0 },
    // ask_question
    { intent: 'ask_question', answer: 'because the sky is blue!', confidence: 0.95 },
    { intent: 'ask_question', answer: 'tell your grown-up', confidence: 0.9, concern: true },
    // noise_play (catalog hit vs Haiku fallback)
    { intent: 'noise_play', catalog_key: 'chicken', confidence: 1.0 },
    { intent: 'noise_play', play_catalog: 'fart', fallback_text: 'here is a fart instead', confidence: 0.9 },
    // joke_tell (catalog or Haiku)
    { intent: 'joke_tell', joke_id: 'j001', setup: 'why?', punchline: 'because!', confidence: 1.0 },
    { intent: 'joke_tell', setup: 'why did the…', punchline: '…because!', confidence: 0.9 },
  ])('pokeToAction accepts applied with intent %o', (intent) => {
    const action = pokeToAction({ utterance_id: 'u1', kind: 'applied', payload: { intent } });
    expect(action).not.toBeNull();
    if (action && action.type === 'sse') {
      expect(action.kind).toBe('applied');
      expect(action.intent?.intent).toBe(intent.intent);
    }
  });
});

describe('event_add intent + applied reply', () => {
  const intent = { intent: 'event_add', title: 'Soccer', date: '2026-06-15', time: '16:00', confidence: 0.7 };

  it('pokeToAction accepts a confirming event_add', () => {
    const a = pokeToAction({ kind: 'confirming', utterance_id: 'u', payload: { intent, transcript: 'add soccer thursday 4pm' } });
    expect(a).not.toBeNull();
    if (a && a.type === 'sse') {
      expect(a.intent?.intent).toBe('event_add');
    }
  });

  it('applied carries the reply text', () => {
    const a = pokeToAction({ kind: 'applied', utterance_id: 'u', payload: { intent, reply: 'Added Soccer on Monday at 4pm.' } });
    expect(a).not.toBeNull();
    if (a && a.type === 'sse') {
      const s = reduceOverlay({ kind: 'idle' }, a);
      expect(s).toEqual({ kind: 'applied', utterance_id: 'u', intent, reply: 'Added Soccer on Monday at 4pm.' });
    }
  });
});
