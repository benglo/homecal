import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { ZONE } from '../util/time';

/** Returns today's date in Brisbane as `YYYY-MM-DD` and re-evaluates at the next
 *  Brisbane midnight so a wall mounted long enough to roll over picks up the new
 *  day without a refresh. Brisbane is fixed UTC+10 (no DST) so the boundary is
 *  exactly midnight local. */
export function useBrisbaneDate(): string {
  const [date, setDate] = useState(() => brisbaneToday());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule(): void {
      const ms = msUntilBrisbaneMidnight();
      // Add a small fudge so we land just past midnight, not right on the boundary.
      timer = setTimeout(() => {
        setDate(brisbaneToday());
        schedule();
      }, ms + 100);
    }

    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  return date;
}

function brisbaneToday(): string {
  return DateTime.now().setZone(ZONE).toFormat('yyyy-LL-dd');
}

function msUntilBrisbaneMidnight(): number {
  const now = DateTime.now().setZone(ZONE);
  const nextMidnight = now.plus({ days: 1 }).startOf('day');
  return Math.max(0, nextMidnight.toMillis() - now.toMillis());
}
