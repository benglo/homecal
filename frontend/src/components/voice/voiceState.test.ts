import { describe, it, expect } from 'vitest';
import { reduceOverlay, initialOverlay } from './voiceState';

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
});
