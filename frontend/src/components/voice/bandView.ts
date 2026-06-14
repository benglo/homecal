import type { OverlayState } from './voiceState';

export type BandTone = 'accent' | 'ok' | 'warn';

export interface BandView {
  visible: boolean;
  tone: BandTone;
  /** Main line — the transcript while thinking, the reply when applied. */
  primary: string;
  /** Sub-line, e.g. "thinking…". Empty when not needed. */
  secondary: string;
  /** Whether to show the animated listening waveform. */
  showVu: boolean;
}

const HIDDEN: BandView = { visible: false, tone: 'accent', primary: '', secondary: '', showVu: false };

// Bound the transcript before it hits the DOM + aria-live region. A pathological
// STT result (rare runaway / cloud-audio fallback) would otherwise be announced
// in full by a screen reader and blow out the single-line band.
const MAX_TRANSCRIPT = 140;

/** Pure view-model for VoiceBand. The band is the wall's active-voice surface;
 *  `confirming` is rendered by ConfirmCard (which already shows the transcript)
 *  and the offline/idle states by the chip, so the band stays hidden for those. */
export function bandView(state: OverlayState): BandView {
  switch (state.kind) {
    case 'listening':
      return { visible: true, tone: 'accent', primary: 'Listening…', secondary: '', showVu: true };
    case 'thinking': {
      const t = state.transcript_partial.trim().slice(0, MAX_TRANSCRIPT);
      return t
        ? { visible: true, tone: 'accent', primary: `"${t}"`, secondary: 'thinking…', showVu: false }
        : { visible: true, tone: 'accent', primary: 'thinking…', secondary: '', showVu: false };
    }
    case 'applied':
      return { visible: true, tone: 'ok', primary: state.reply?.trim() || 'Done', secondary: '', showVu: false };
    case 'failed':
      return { visible: true, tone: 'warn', primary: "Didn't catch that", secondary: '', showVu: false };
    case 'idle':
    case 'confirming':
    case 'mic_offline':
    case 'voice_offline':
      return HIDDEN;
  }
}
