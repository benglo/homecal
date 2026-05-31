import { DateTime } from 'luxon';
import { StatusDot } from '../primitives/StatusDot';

interface Props {
  now: DateTime;
  dataUpdatedAt: number;
  isError: boolean;
}

/** Lightweight phone top bar: current date + stale indicator only (no clock, no live dot). */
export function PhoneHeader({ now, dataUpdatedAt, isError }: Props) {
  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-border bg-surface"
      style={{ padding: '14px 18px', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}
    >
      <div>
        <div className="font-bold text-text" style={{ fontSize: 20, letterSpacing: '-0.01em' }}>
          {now.toFormat('cccc')}
        </div>
        <div className="text-text-muted" style={{ fontSize: 14 }}>
          {now.toFormat('d LLLL yyyy')}
        </div>
      </div>
      <StatusDot dataUpdatedAt={dataUpdatedAt} isError={isError} />
    </header>
  );
}
