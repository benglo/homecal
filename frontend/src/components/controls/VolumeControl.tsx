import { useEffect, useRef, useState } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { ApiError } from '../../core/api/client';
import { useVoiceStatus } from '../../core/hooks/useData';
import { useSetVolume, useSetAudioMute } from '../../core/hooks/useMutations';
import { TogglePill } from '../ui/TogglePill';

export type VolumeGlyph = 'muted' | 'low' | 'high';

/** Pure: which speaker glyph a given state shows. Colour is never the only
 *  signal — the glyph + the % label both convey the level (spec §0). */
export function volumeGlyph(volume: number, audioMuted: boolean): VolumeGlyph {
  if (audioMuted || volume <= 0) return 'muted';
  if (volume < 50) return 'low';
  return 'high';
}

const ICONS = { muted: VolumeX, low: Volume1, high: Volume2 } as const;

// Trailing-edge debounce: while the slider is being adjusted (pointer drag OR
// arrow keys, both of which fire onChange), only the last value in a quiet
// window is PUT — a drag can't flood the API. The same "interacting" window,
// cleared when the debounce fires, keeps an SSE refetch from snapping the thumb
// back mid-adjust. Driving off onChange (not pointerup) avoids a stuck flag if
// the pointer is released off the element.
const COMMIT_DEBOUNCE_MS = 150;

export function VolumeControl() {
  const { data: status } = useVoiceStatus();
  const setVolume = useSetVolume();
  const setAudioMute = useSetAudioMute();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const serverVolume = status?.volume ?? 60;
  const audioMuted = !!status?.audio_muted;
  const online = status?.mic_online ?? false;

  // Local value keeps the slider smooth while adjusting; re-sync from the
  // server only when idle (an SSE invalidation would otherwise fight the drag).
  const [interacting, setInteracting] = useState(false);
  const [local, setLocal] = useState(serverVolume);
  useEffect(() => {
    if (!interacting) setLocal(serverVolume);
  }, [serverVolume, interacting]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = (n: number) => {
    setInteracting(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setVolume.mutate(n, {
        onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not set volume — try again.'),
        onSuccess: () => setErr(null),
      });
      setInteracting(false);
    }, COMMIT_DEBOUNCE_MS);
  };

  const toggleMute = () => {
    setAudioMute.mutate(!audioMuted, {
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not change mute — try again.'),
      onSuccess: () => setErr(null),
    });
  };

  const glyph = volumeGlyph(local, audioMuted);
  const Icon = ICONS[glyph];

  return (
    <div style={{ position: 'relative' }}>
      <TogglePill
        active={audioMuted}
        onClick={() => setOpen(!open)}
        ariaLabel={`Speaker volume ${local}%${audioMuted ? ', muted' : ''}`}
      >
        <Icon size={16} />
        <span>{audioMuted ? 'muted' : `${local}%`}</span>
      </TogglePill>
      {open && (
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
            minWidth: 240,
            padding: 4,
            zIndex: 50,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
            <Icon size={18} />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={local}
              aria-label="Speaker volume"
              onChange={(e) => {
                const n = Number(e.target.value);
                setLocal(n);
                commit(n);
              }}
              style={{ flex: 1, minWidth: 120 }}
            />
            <span style={{ minWidth: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {local}%
            </span>
          </div>
          <button
            role="menuitem"
            onClick={toggleMute}
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
            {audioMuted ? 'Unmute speakers' : 'Mute speakers'}
          </button>
          {err && (
            <div style={{ padding: '6px 14px 10px', fontSize: 12, color: 'var(--danger, #D55E00)' }}>
              {err}
            </div>
          )}
          {!online && (
            <div style={{ padding: '6px 14px 10px', fontSize: 12, color: 'var(--text-faint)' }}>
              Speaker offline — changes apply when it reconnects.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
