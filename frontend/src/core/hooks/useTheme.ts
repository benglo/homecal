import { useEffect } from 'react';
import type { DateTime } from 'luxon';

/** Auto day/night on the wall by Brisbane hour (day 06:30–19:30). */
export function useWallTheme(now: DateTime): void {
  useEffect(() => {
    const minutes = now.hour * 60 + now.minute;
    const isDay = minutes >= 390 && minutes < 1170; // 06:30..19:30
    document.documentElement.setAttribute('data-theme', isDay ? 'day' : 'night');
  }, [now.hour, now.minute]);
}
