import { Mic, MicOff, Loader2, Check, AlertCircle } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import type { OverlayState } from './voiceState';

interface Props {
  state: OverlayState;
  muted: boolean;
}

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

const LABEL_BY_KIND: Record<Kind, string> = {
  idle: 'say "hey mycroft"',
  listening: 'listening…',
  thinking: 'thinking…',
  confirming: 'confirm?',
  applied: 'done',
  failed: "didn't catch that",
  mic_offline: 'mic offline',
  voice_offline: 'voice offline',
};

const ACCENT_COLOR_KINDS: ReadonlySet<Kind> = new Set(['listening', 'thinking']);
const PULSING_KINDS: ReadonlySet<Kind> = new Set(['listening', 'thinking']);

const ringFor = (k: Kind): string => {
  if (ACCENT_COLOR_KINDS.has(k)) return 'var(--accent)';
  if (k === 'applied') return 'var(--accent-ink)';
  return 'var(--text-muted)';
};

export function EarGlyph({ state, muted }: Props) {
  const Icon = muted ? MicOff : ICON_BY_KIND[state.kind];
  const label = muted ? 'voice muted' : LABEL_BY_KIND[state.kind];
  const pulsing = PULSING_KINDS.has(state.kind);

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--surface-2)',
        color: 'var(--text)',
        boxShadow: 'var(--shadow-sm)',
        fontSize: 13,
        fontWeight: 500,
        opacity: state.kind === 'idle' && !muted ? 0.55 : 0.95,
        transition: 'opacity 200ms var(--ease)',
      }}
    >
      <Icon
        size={18}
        color={ringFor(state.kind)}
        style={{
          animation:
            state.kind === 'thinking'
              ? 'spin 1s linear infinite'
              : pulsing
                ? 'voicePulse 1.2s var(--ease) infinite'
                : undefined,
        }}
      />
      <span>{label}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
        {state.kind === 'voice_offline' ? 'no network' : 'device-only · LAN'}
      </span>
    </div>
  );
}
