import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Timer as TimerIcon, X } from 'lucide-react';
import type { Timer } from '../../core/model/types';
import { useTimers } from '../../core/hooks/useData';
import { useClock } from '../../core/hooks/useClock';
import { api } from '../../core/api/client';

/** Bottom-right stack of active timers. Counts down via the shared clock;
 *  expired chips flash until tapped. */
export function TimerStack() {
  const timersQ = useTimers();
  const now = useClock();
  const qc = useQueryClient();

  // onSettled covers both success and error: a failed cancel/ack should
  // re-fetch so the chip reverts to the true server state rather than
  // hanging on the wall forever.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['timers'] });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelTimer(id),
    onSettled: invalidate,
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) => api.acknowledgeTimer(id),
    onSettled: invalidate,
  });

  const timers = timersQ.data ?? [];
  if (timers.length === 0) return null;

  return (
    <div
      className="fixed flex flex-col gap-2"
      style={{ bottom: 88, right: 16, zIndex: 30 }}
      aria-live="polite"
    >
      {timers.map((t) => (
        <TimerChip
          key={t.id}
          timer={t}
          nowMs={now.toMillis()}
          onCancel={() => cancel.mutate(t.id)}
          onAcknowledge={() => acknowledge.mutate(t.id)}
        />
      ))}
    </div>
  );
}

interface ChipProps {
  timer: Timer;
  nowMs: number;
  onCancel: () => void;
  onAcknowledge: () => void;
}

function TimerChip({ timer, nowMs, onCancel, onAcknowledge }: ChipProps) {
  const remainingMs = Math.max(0, Date.parse(timer.expiresAt) - nowMs);
  const expired = remainingMs === 0;
  const label = timer.label ?? 'Timer';
  const bg = expired ? 'var(--c-dinner)' : 'var(--surface-2)';
  const fg = expired ? '#fff' : 'var(--text)';

  return (
    <button
      type="button"
      onClick={expired ? onAcknowledge : onCancel}
      className="flex items-center gap-3 rounded-full border shadow-sm"
      aria-label={expired ? `Dismiss ${label} timer` : `Cancel ${label} timer`}
      style={{
        padding: '10px 16px 10px 14px',
        background: bg,
        color: fg,
        borderColor: expired ? bg : 'var(--border)',
        minWidth: 180,
        animation: expired ? 'timer-flash 1s steps(2, end) infinite' : undefined,
      }}
    >
      <TimerIcon size={20} />
      <span className="font-semibold capitalize" style={{ fontSize: 16 }}>{label}</span>
      <span className="ml-auto font-mono tabular-nums" style={{ fontSize: 20, fontWeight: 600 }}>
        {formatRemaining(remainingMs)}
      </span>
      <X size={18} aria-hidden style={{ opacity: 0.7 }} />
    </button>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
