import { getDb } from '../db';
import { nowIso } from '../util/time';

export function getMuteUntil(): string | null {
  const row = getDb()
    .prepare('SELECT mute_until FROM voice_settings WHERE id = 1')
    .get() as { mute_until: string | null } | undefined;
  return row?.mute_until ?? null;
}

export function setMuteUntil(iso: string | null): void {
  getDb()
    .prepare(`UPDATE voice_settings SET mute_until = ?, updated_at = ? WHERE id = 1`)
    .run(iso, nowIso());
}

/** Master speaker volume, 0–100. Applied on the Pi via wpctl. */
export function getVolume(): number {
  const row = getDb()
    .prepare('SELECT volume FROM voice_settings WHERE id = 1')
    .get() as { volume: number } | undefined;
  return row?.volume ?? 60;
}

export function setVolume(level: number): void {
  // Belt-and-braces clamp: zod already rejects out-of-range at the boundary,
  // but the repo stays safe for any direct/seed caller (CHECK would 500).
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  getDb()
    .prepare(`UPDATE voice_settings SET volume = ?, updated_at = ? WHERE id = 1`)
    .run(clamped, nowIso());
}

/** Speaker (audio-output) mute — distinct from mute_until (voice-listening). */
export function getAudioMuted(): boolean {
  const row = getDb()
    .prepare('SELECT audio_muted FROM voice_settings WHERE id = 1')
    .get() as { audio_muted: number } | undefined;
  return row?.audio_muted === 1;
}

export function setAudioMuted(muted: boolean): void {
  getDb()
    .prepare(`UPDATE voice_settings SET audio_muted = ?, updated_at = ? WHERE id = 1`)
    .run(muted ? 1 : 0, nowIso());
}
