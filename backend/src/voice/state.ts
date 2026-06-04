import { isoUtc } from '../util/time';

const HEARTBEAT_TIMEOUT_MS = 60_000;

export interface VoiceState {
  lastHeartbeatAt(): string | null;
  recordHeartbeat(at: Date): void;
  micOnline(now: Date): boolean;
}

/** In-memory liveness state for the Pi voice service. Mute state lives in
 *  the `voice_settings` DB row (read via `voiceSettings.getMuteUntil()`);
 *  do not duplicate it here. Heartbeat timestamps are stored second-precision
 *  (`Z`-suffixed, no millis) to match the rest of the API (spec §0 locked
 *  storage format). */
export function createVoiceState(): VoiceState {
  let lastHb: string | null = null;
  return {
    lastHeartbeatAt: () => lastHb,
    recordHeartbeat: (at) => {
      lastHb = isoUtc(at);
    },
    micOnline: (now) => {
      if (!lastHb) return false;
      return now.getTime() - new Date(lastHb).getTime() <= HEARTBEAT_TIMEOUT_MS;
    },
  };
}

/** Module singleton consumed by `routes/voice.ts` and tests. Routes must use
 *  this instance — calling `createVoiceState()` from a route would create a
 *  parallel state machine that diverges from what tests assert against. */
export const voiceState: VoiceState = createVoiceState();
