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
