const HEARTBEAT_TIMEOUT_MS = 60_000;

export interface VoiceState {
  lastHeartbeatAt(): string | null;
  recordHeartbeat(at: Date): void;
  micOnline(now: Date): boolean;
  muteUntil(): string | null;
  setMuteUntil(iso: string | null): void;
  isMuted(now: Date): boolean;
}

export function createVoiceState(): VoiceState {
  let lastHb: string | null = null;
  let mute: string | null = null;
  return {
    lastHeartbeatAt: () => lastHb,
    recordHeartbeat: (at) => { lastHb = at.toISOString(); },
    micOnline: (now) => {
      if (!lastHb) return false;
      return now.getTime() - new Date(lastHb).getTime() <= HEARTBEAT_TIMEOUT_MS;
    },
    muteUntil: () => mute,
    setMuteUntil: (iso) => { mute = iso; },
    isMuted: (now) => {
      if (!mute) return false;
      return new Date(mute).getTime() > now.getTime();
    },
  };
}

// R20 — module singleton consumed by routes/voice.ts and tests; do not import `createVoiceState` from route code.
export const voiceState: VoiceState = createVoiceState();
