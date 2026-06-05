import { useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useVoiceStatus } from '../../core/hooks/useData';
import { useMuteVoice } from '../../core/hooks/useMutations';
import { TogglePill } from '../ui/TogglePill';

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

export function MuteToggle() {
  const { data: status } = useVoiceStatus();
  const mute = useMuteVoice();
  const [open, setOpen] = useState(false);
  const muted = !!status?.muted;
  const Icon = muted ? MicOff : Mic;

  return (
    <div style={{ position: 'relative' }}>
      <TogglePill
        active={muted}
        onClick={() => (muted ? mute.mutate(null) : setOpen(!open))}
        ariaLabel={muted ? `Voice muted until ${status?.mute_until}` : 'Mute voice'}
      >
        <Icon size={16} />
        <span>{muted ? 'muted' : 'voice'}</span>
      </TogglePill>
      {open && !muted && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
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
              onClick={() => {
                mute.mutate(p.compute());
                setOpen(false);
              }}
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
