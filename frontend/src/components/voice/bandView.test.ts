import { describe, it, expect } from 'vitest';
import { bandView } from './bandView';

describe('bandView', () => {
  it('idle → hidden', () => {
    expect(bandView({ kind: 'idle' }).visible).toBe(false);
  });
  it('listening → accent tone + listening line', () => {
    const v = bandView({ kind: 'listening', utterance_id: 'u', vu: 0.4 });
    expect(v).toMatchObject({ visible: true, tone: 'accent', primary: 'Listening…' });
  });
  it('thinking shows the transcript when present', () => {
    const v = bandView({ kind: 'thinking', utterance_id: 'u', transcript_partial: 'add soccer thursday' });
    expect(v).toMatchObject({ visible: true, tone: 'accent', primary: '"add soccer thursday"', secondary: 'thinking…' });
  });
  it('thinking with no transcript yet falls back', () => {
    expect(bandView({ kind: 'thinking', utterance_id: 'u', transcript_partial: '' }).primary).toBe('thinking…');
  });
  it('applied shows the reply in the ok tone', () => {
    const v = bandView({ kind: 'applied', utterance_id: 'u', intent: { intent: 'event_add', title: 'Soccer', date: '2026-06-15', confidence: 1 }, reply: 'Added Soccer.' });
    expect(v).toMatchObject({ visible: true, tone: 'ok', primary: 'Added Soccer.' });
  });
  it('failed → warn tone', () => {
    expect(bandView({ kind: 'failed', utterance_id: 'u', reason: 'no' })).toMatchObject({ visible: true, tone: 'warn' });
  });
  it('confirming is owned by ConfirmCard, band stays hidden', () => {
    expect(bandView({ kind: 'confirming', utterance_id: 'u', intent: { intent: 'event_add', title: 'X', date: '2026-06-15', confidence: 0.7 }, transcript: 't' }).visible).toBe(false);
  });
  it('offline kinds hide the band (chip shows the status)', () => {
    expect(bandView({ kind: 'mic_offline' }).visible).toBe(false);
    expect(bandView({ kind: 'voice_offline' }).visible).toBe(false);
  });
});
