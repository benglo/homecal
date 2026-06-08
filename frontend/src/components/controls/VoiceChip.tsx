import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { Mic, MicOff, Loader2, Check, AlertCircle } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useVoiceStatus } from '../../core/hooks/useData';
import { useMuteVoice } from '../../core/hooks/useMutations';
import { useIsWall } from '../../core/hooks/useIsWall';
import { ZONE } from '../../core/util/time';
import type { OverlayState } from '../voice/voiceState';
import type { ParsedIntent, VoiceStatus } from '../../core/model/types';

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;
type Kind = OverlayState['kind'];

const ICON_BY_KIND: Record<Kind, LucideIcon> = {
  idle: Mic,
  listening: Mic,
  thinking: Loader2,
  confirming: Mic,
  applied: Check,
  failed: AlertCircle,
  mic_offline: AlertCircle,
  voice_offline: AlertCircle,
};

const PULSING_KINDS: ReadonlySet<Kind> = new Set(['listening', 'confirming']);
const ACCENT_KINDS: ReadonlySet<Kind> = new Set(['listening', 'thinking', 'confirming']);
const WARN_KINDS: ReadonlySet<Kind> = new Set(['failed', 'mic_offline', 'voice_offline']);

type Preset = { label: string; compute: () => string };
const PRESETS: Preset[] = [
  { label: '1 hour', compute: () => new Date(Date.now() + 60 * 60_000).toISOString() },
  {
    label: 'Until 7am',
    compute: () => {
      const d = new Date();
      d.setHours(7, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      return d.toISOString();
    },
  },
  {
    label: 'Forever',
    compute: () => new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(),
  },
];

/** Returns the CSS colour for the ambient TTS-health dot on the wall chip.
 *  Uses actual repo tokens: --ok (green), --stale (amber), --text-muted (grey). */
export function ttsDotColor(status: Pick<VoiceStatus, 'mic_online' | 'muted' | 'last_tts_provider'>): string {
  if (!status.mic_online || status.muted) return 'var(--text-muted)';
  if (status.last_tts_provider === 'clip' || status.last_tts_provider === 'none') {
    return 'var(--stale)';
  }
  return 'var(--ok)';
}

/** What the chip shows for a given overlay state when voice is NOT muted. */
export function labelFor(state: OverlayState): string {
  switch (state.kind) {
    case 'idle': return 'say "hey mycroft"';
    case 'listening': return 'listening…';
    case 'thinking': return 'thinking…';
    case 'confirming': return 'confirm?';
    case 'applied': return appliedLabel(state.intent);
    case 'failed': return "didn't catch that";
    case 'mic_offline': return 'mic offline';
    case 'voice_offline': return 'voice offline';
  }
}

function appliedLabel(intent: ParsedIntent): string {
  switch (intent.intent) {
    case 'dinner_set': return `saved ${intent.meal}`;
    case 'chore_complete': return `${intent.person} ✓ ${intent.chore}`;
    case 'query_dinner':
    case 'query_agenda': return 'done';
    case 'timer_set': return 'timer set';
    case 'timer_extend': return 'timer extended';
    case 'timer_cancel': return 'timer cancelled';
    case 'timer_query': return 'done';
    case 'ask_question': return 'answered';
    case 'joke_tell': return '😄 joke';
    case 'noise_play': return '';  // no chip flash; the noise IS the feedback
    case 'unknown': return "didn't catch that";
  }
}

/** "muted · 7am" for short-windowed; "muted · 3 Jun" for cross-day; "muted" for forever-ish. */
export function muteLabel(muteUntil: string | null | undefined, now: DateTime = DateTime.now().setZone(ZONE)): string {
  if (!muteUntil) return 'muted';
  const until = DateTime.fromISO(muteUntil).setZone(ZONE);
  if (!until.isValid) return 'muted';
  const days = Math.round(until.diff(now, 'days').days);
  if (days > 30) return 'muted'; // "Forever" preset (365d)
  if (until.hasSame(now, 'day')) return `muted · ${until.toFormat('h:mma').toLowerCase()}`;
  if (days === 1) return `muted · ${until.toFormat('h:mma').toLowerCase()}`;
  return `muted · ${until.toFormat('d LLL')}`;
}

interface Props {
  state: OverlayState;
}

/**
 * Single-chip voice UI for the wall: status + wake-word hint + mute control.
 *
 * Replaces the old split between `MuteToggle` (in ControlBar) and the floating
 * `EarGlyph` (above it). Both were showing a mic icon in the same corner;
 * users couldn't tell which mic was the control.
 *
 * Tap behavior:
 *   - idle/active states → open mute-presets dropdown
 *   - muted              → instant unmute (mirror MuteToggle's behavior)
 */
export function VoiceChip({ state }: Props) {
  const { data: status } = useVoiceStatus();
  const mute = useMuteVoice();
  const isWall = useIsWall();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const muted = !!status?.muted;
  const offline = state.kind === 'mic_offline' || state.kind === 'voice_offline';

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const Icon = muted ? MicOff : ICON_BY_KIND[state.kind];
  const label = muted ? muteLabel(status?.mute_until ?? null) : labelFor(state);

  // noise_play returns empty applied label — render nothing so the chip doesn't
  // momentarily flash blank during the noise. Spec §8.
  if (label === '' && state.kind === 'applied') return null;

  const accent =
    muted ? 'var(--text-muted)' :
    WARN_KINDS.has(state.kind) ? 'var(--warn, #d97706)' :
    ACCENT_KINDS.has(state.kind) ? 'var(--accent)' :
    state.kind === 'applied' ? 'var(--accent-ink, var(--accent))' :
    'var(--text-muted)';

  const pulsing = !muted && PULSING_KINDS.has(state.kind);
  const spinning = !muted && state.kind === 'thinking';
  // Faint when truly idle (the wake-word invitation); confident otherwise.
  const opacity = state.kind === 'idle' && !muted ? 0.7 : 1;

  const handleClick = () => {
    if (offline) return; // nothing to do; chip is a status indicator
    if (muted) {
      mute.mutate(null);
      setOpen(false);
      return;
    }
    setOpen((o) => !o);
  };

  const dot = isWall && status ? (
    <span
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: ttsDotColor(status),
      }}
      aria-hidden="true"
    />
  ) : null;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {dot}
      <button
        type="button"
        onClick={handleClick}
        aria-label={muted ? `Voice muted; tap to unmute` : `Voice: ${label}`}
        aria-pressed={muted}
        disabled={offline}
        className="inline-flex items-center gap-2 rounded-full font-semibold transition-colors"
        style={{
          minHeight: 48,
          padding: '10px 18px',
          fontSize: 15,
          background: muted ? 'var(--surface-2)' : 'var(--surface)',
          color: 'var(--text)',
          border: `1px solid ${muted ? 'var(--border)' : 'transparent'}`,
          opacity,
          cursor: offline ? 'default' : 'pointer',
        }}
      >
        <Icon
          size={18}
          color={accent}
          style={{
            animation: spinning
              ? 'spin 1s linear infinite'
              : pulsing
                ? 'voicePulse 1.2s var(--ease) infinite'
                : undefined,
            flexShrink: 0,
          }}
        />
        <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      </button>

      {open && !muted && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 8,
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow)',
            minWidth: 200,
            padding: 4,
            zIndex: 50,
          }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.label}
              role="menuitem"
              onClick={() => { mute.mutate(p.compute()); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 14px',
                textAlign: 'left',
                border: 0,
                background: 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
                borderRadius: 'var(--r-sm)',
                fontSize: 15,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Mute · {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
