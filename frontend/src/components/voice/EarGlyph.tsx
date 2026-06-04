import { Mic, MicOff, Loader2, Check, AlertCircle } from 'lucide-react';
import type { OverlayState } from './voiceState';

interface Props {
  state: OverlayState;
  muted: boolean;
}

const ringFor = (k: OverlayState['kind']) =>
  k === 'listening' || k === 'thinking'
    ? 'var(--accent)'
    : k === 'applied'
      ? 'var(--accent-ink)'
      : 'var(--text-muted)';

export function EarGlyph({ state, muted }: Props) {
  const pulsing = state.kind === 'listening' || state.kind === 'thinking';
  const Icon = muted
    ? MicOff
    : state.kind === 'thinking'
      ? Loader2
      : state.kind === 'applied'
        ? Check
        : state.kind === 'failed' || state.kind === 'mic_offline' || state.kind === 'voice_offline'
          ? AlertCircle
          : Mic;

  const label = muted
    ? 'voice muted'
    : state.kind === 'idle'
      ? 'say "hey mycroft"'
      : state.kind === 'listening'
        ? 'listening…'
        : state.kind === 'thinking'
          ? 'thinking…'
          : state.kind === 'confirming'
            ? 'confirm?'
            : state.kind === 'applied'
              ? 'done'
              : state.kind === 'failed'
                ? "didn't catch that"
                : state.kind === 'mic_offline'
                  ? 'mic offline'
                  : 'voice offline';

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
