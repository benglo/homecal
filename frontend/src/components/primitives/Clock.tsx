import type { DateTime } from 'luxon';

/** Live tabular clock + date. Always ticking = the screen-is-alive signal. */
export function Clock({ now }: { now: DateTime }) {
  return (
    <div className="text-right">
      <div className="font-mono font-semibold leading-none tabular-nums" style={{ fontSize: 64, letterSpacing: '-0.03em' }}>
        {now.toFormat('HH:mm')}
        <span className="text-text-faint font-medium" style={{ fontSize: 30 }}>
          {now.toFormat(':ss')}
        </span>
      </div>
      <div className="text-text-muted font-medium mt-1.5" style={{ fontSize: 26 }}>
        {now.toFormat('cccc d LLLL')}
      </div>
    </div>
  );
}
