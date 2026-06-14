import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { labelFor, muteLabel } from './VoiceChip';
import { ZONE } from '../../core/util/time';

describe('labelFor', () => {
  it('idle invites the wake word', () => {
    expect(labelFor({ kind: 'idle' })).toBe('say "hey luna"');
  });

  it('listening and thinking show progress', () => {
    expect(labelFor({ kind: 'listening', utterance_id: 'u', vu: 0 })).toBe('listening…');
    expect(labelFor({ kind: 'thinking', utterance_id: 'u', transcript_partial: '' })).toBe('thinking…');
  });

  it('confirming prompts the user', () => {
    expect(
      labelFor({
        kind: 'confirming',
        utterance_id: 'u',
        intent: { intent: 'dinner_set', date: '2026-06-05', meal: 'Tacos', confidence: 0.7 },
        transcript: 'tonight tacos',
      }),
    ).toBe('confirm?');
  });

  it('applied(dinner_set) echoes the canonical meal name', () => {
    expect(
      labelFor({
        kind: 'applied',
        utterance_id: 'u',
        intent: { intent: 'dinner_set', date: '2026-06-05', meal: 'Tacos', confidence: 1 },
      }),
    ).toBe('saved Tacos');
  });

  it('applied(chore_complete) credits the person', () => {
    expect(
      labelFor({
        kind: 'applied',
        utterance_id: 'u',
        intent: { intent: 'chore_complete', person: 'Mia', chore: 'Bathroom', confidence: 1 },
      }),
    ).toBe('Mia ✓ Bathroom');
  });

  it('applied(query_*) just says done', () => {
    expect(
      labelFor({
        kind: 'applied',
        utterance_id: 'u',
        intent: { intent: 'query_dinner', date: '2026-06-05', confidence: 1 },
      }),
    ).toBe('done');
  });

  it('warn states are surfaced', () => {
    expect(labelFor({ kind: 'failed', utterance_id: 'u', reason: 'x' })).toBe("didn't catch that");
    expect(labelFor({ kind: 'mic_offline' })).toBe('mic offline');
    expect(labelFor({ kind: 'voice_offline' })).toBe('voice offline');
  });
});

describe('muteLabel', () => {
  const now = DateTime.fromISO('2026-06-05T10:00:00', { zone: ZONE });

  it('no mute_until → plain "muted"', () => {
    expect(muteLabel(null, now)).toBe('muted');
    expect(muteLabel(undefined, now)).toBe('muted');
  });

  it('invalid timestamp → plain "muted"', () => {
    expect(muteLabel('not-a-date', now)).toBe('muted');
  });

  it('today-window shows local time, lowercased', () => {
    const until = now.plus({ hours: 1 }).toUTC().toISO();
    expect(muteLabel(until, now)).toBe('muted · 11:00am');
  });

  it('tomorrow-morning shows the time too (so 7am preset reads naturally)', () => {
    const until = now.plus({ days: 1 }).set({ hour: 7, minute: 0 }).toUTC().toISO();
    expect(muteLabel(until, now)).toMatch(/^muted · \d{1,2}:\d\d(am|pm)$/);
  });

  it('multi-day shows date', () => {
    const until = now.plus({ days: 5 }).toUTC().toISO();
    expect(muteLabel(until, now)).toMatch(/^muted · \d{1,2} \w{3}$/);
  });

  it('Forever preset (≥30 days) collapses to plain "muted"', () => {
    const until = now.plus({ days: 365 }).toUTC().toISO();
    expect(muteLabel(until, now)).toBe('muted');
  });
});

describe('labelFor — applied with kid intents', () => {
  it('ask_question shows "answered"', () => {
    const label = labelFor({
      kind: 'applied',
      utterance_id: 'u1',
      intent: { intent: 'ask_question', answer: 'because!', confidence: 0.95 },
    });
    expect(label).toBe('answered');
  });

  it('joke_tell shows "😄 joke"', () => {
    const label = labelFor({
      kind: 'applied',
      utterance_id: 'u1',
      intent: { intent: 'joke_tell', setup: 'why?', punchline: 'because!', confidence: 1.0 },
    });
    expect(label).toBe('😄 joke');
  });

  it('noise_play (catalog hit) returns empty string — no chip flash', () => {
    const label = labelFor({
      kind: 'applied',
      utterance_id: 'u1',
      intent: { intent: 'noise_play', catalog_key: 'chicken', confidence: 1.0 },
    });
    expect(label).toBe('');
  });

  it('noise_play (Haiku fallback) also returns empty string', () => {
    const label = labelFor({
      kind: 'applied',
      utterance_id: 'u1',
      intent: { intent: 'noise_play', play_catalog: 'chicken', fallback_text: 'try a chicken', confidence: 0.9 },
    });
    expect(label).toBe('');
  });
});

import { ttsDotColor } from './VoiceChip';

describe('ttsDotColor', () => {
  it('green when mic online and last_tts_provider is local', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'kokoro_lan' } as any))
      .toBe('var(--ok)');
  });

  it('green when mic online and last_tts_provider is cloud (still working)', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'openrouter' } as any))
      .toBe('var(--ok)');
  });

  it('amber when last_tts_provider is clip (degraded)', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'clip' } as any))
      .toBe('var(--stale)');
  });

  it('amber when last_tts_provider is none (degraded)', () => {
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: 'none' } as any))
      .toBe('var(--stale)');
  });

  it('grey when muted', () => {
    expect(ttsDotColor({ mic_online: true, muted: true, last_tts_provider: 'kokoro_lan' } as any))
      .toBe('var(--text-muted)');
  });

  it('grey when mic offline', () => {
    expect(ttsDotColor({ mic_online: false, muted: false, last_tts_provider: 'kokoro_lan' } as any))
      .toBe('var(--text-muted)');
  });

  it('green when no history yet (last_tts_provider null) and mic online', () => {
    // Optimistic — no failures recorded means assume things are fine.
    expect(ttsDotColor({ mic_online: true, muted: false, last_tts_provider: null } as any))
      .toBe('var(--ok)');
  });
});
