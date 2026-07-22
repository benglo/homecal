import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { DateTime } from 'luxon';
import type { WallView } from '../../core/model/types';
import { ZONE } from '../../core/util/time';
import { VoiceChip } from './VoiceChip';
import { VolumeControl } from './VolumeControl';
import type { OverlayState } from '../voice/voiceState';

interface Props {
  view: WallView;
  anchor: DateTime;
  onView: (v: WallView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isToday: boolean;
  onQuickAdd: () => void;
  voiceState: OverlayState;
}

function periodLabel(view: WallView, anchor: DateTime): string {
  const a = anchor.setZone(ZONE);
  if (view === 'month') return a.toFormat('LLLL yyyy');
  if (view === 'week') {
    const start = a.startOf('week');
    const end = start.plus({ days: 6 });
    return start.month === end.month
      ? `${start.toFormat('d')} – ${end.toFormat('d LLL')}`
      : `${start.toFormat('d LLL')} – ${end.toFormat('d LLL')}`;
  }
  return a.toFormat('cccc d LLL');
}

const VIEWS: WallView[] = ['agenda', 'week', 'month', 'chores'];

export function ControlBar({ view, anchor, onView, onPrev, onNext, onToday, isToday, onQuickAdd, voiceState }: Props) {
  return (
    <div className="flex shrink-0 items-center justify-between bg-surface-2 border-t border-border" style={{ height: 88, padding: '0 24px' }}>
      {/* Left: view switcher */}
      <div className="inline-flex bg-surface border border-border rounded-full p-1">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={v === view}
            onClick={() => onView(v)}
            className="rounded-full font-semibold capitalize transition-colors"
            style={{
              fontSize: 18,
              padding: '16px 28px',
              minHeight: 64,
              background: v === view ? 'var(--accent)' : 'transparent',
              color: v === view ? '#fff' : 'var(--text-muted)',
            }}
          >
            {v === 'chores' ? '⭐ Chores' : v}
          </button>
        ))}
      </div>

      {/* Center: ‹ Period Label › */}
      <div className="flex items-center gap-2">
        <NavBtn onClick={onPrev} ariaLabel="Previous"><ChevronLeft size={26} /></NavBtn>
        <span
          className="text-center select-none"
          style={{ minWidth: 200, fontSize: 22, fontWeight: 300, letterSpacing: 0.5, color: 'var(--text)' }}
        >
          {periodLabel(view, anchor)}
        </span>
        <NavBtn onClick={onNext} ariaLabel="Next"><ChevronRight size={26} /></NavBtn>
      </div>

      {/* Right: Today + VoiceChip + FAB */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToday}
          disabled={isToday}
          className="rounded-full font-semibold"
          style={{
            fontSize: 15,
            padding: '12px 22px',
            minHeight: 48,
            background: isToday ? 'transparent' : 'var(--surface)',
            border: isToday ? 'none' : '1px solid var(--border)',
            color: isToday ? 'var(--text-faint)' : 'var(--text)',
          }}
        >
          Today
        </button>
        <VoiceChip state={voiceState} />
        <VolumeControl />
        <button
          type="button"
          onClick={onQuickAdd}
          aria-label="Quick add"
          className="grid place-items-center rounded-full shrink-0"
          style={{ width: 64, height: 64, background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
        >
          <Plus size={28} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

function NavBtn({ onClick, ariaLabel, children }: { onClick: () => void; ariaLabel: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="grid place-items-center rounded-full text-text-muted"
      style={{ width: 48, height: 48, background: 'var(--surface)', borderRadius: '50%' }}
    >
      {children}
    </button>
  );
}
