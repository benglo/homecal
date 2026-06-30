import { Mic, Loader2, Check, AlertCircle } from 'lucide-react';
import type { OverlayState } from './voiceState';
import { bandView, type BandTone } from './bandView';

const TONE_COLOR: Record<BandTone, string> = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn, #d97706)',
};

/** Wall-only active-voice band. Slides up over the ControlBar while voice is
 *  active and collapses (renders nothing) when idle. The persistent status
 *  pill + mute live in VoiceChip; the yes/no card is ConfirmCard. */
export function VoiceBand({ state }: { state: OverlayState }) {
  const v = bandView(state);
  if (!v.visible) return null;

  const color = TONE_COLOR[v.tone];
  const Icon = state.kind === 'applied' ? Check : state.kind === 'failed' ? AlertCircle : state.kind === 'thinking' ? Loader2 : Mic;

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute left-0 right-0 bottom-0 flex items-center gap-4 border-t"
      style={{
        // OVERLAY the ControlBar (88px tall) rather than reflowing the calendar —
        // a flex sibling would shrink the grid 88px on every utterance. The root
        // WallLayout div is position:relative (set where VoiceBand is mounted).
        height: 88,
        zIndex: 30,
        padding: '0 24px',
        background: 'var(--surface-2)',
        borderColor: color,
        borderTopWidth: 2,
      }}
    >
      <Icon
        size={22}
        color={color}
        style={{ flexShrink: 0, animation: state.kind === 'thinking' ? 'spin 1s linear infinite' : v.showVu ? 'voicePulse 1.2s var(--ease) infinite' : undefined }}
      />
      {v.showVu && <Waveform color={color} />}
      <span className="flex-1 min-w-0 truncate" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
        {v.primary}
      </span>
      {v.secondary && (
        <span style={{ fontSize: 14, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{v.secondary}</span>
      )}
    </div>
  );
}

/** Five bars pulsing on a stagger — a "hearing you" affordance, not a real VU meter. */
function Waveform({ color }: { color: string }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true" style={{ height: 20 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 16,
            borderRadius: 2,
            background: color,
            animation: `voiceBar 0.9s ${i * 0.12}s ease-in-out infinite`,
            transformOrigin: 'center',
          }}
        />
      ))}
    </span>
  );
}
