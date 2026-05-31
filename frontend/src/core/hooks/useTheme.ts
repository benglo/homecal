import { useEffect, useState } from 'react';
import type { DateTime } from 'luxon';

/** Auto day/night on the wall by Brisbane hour (day 06:30–19:30). */
export function useWallTheme(now: DateTime): void {
  useEffect(() => {
    const minutes = now.hour * 60 + now.minute;
    const isDay = minutes >= 390 && minutes < 1170; // 06:30..19:30
    document.documentElement.setAttribute('data-theme', isDay ? 'day' : 'night');
  }, [now.hour, now.minute]);
}

/** Phone follows the OS colour scheme (no schedule). */
export function usePhoneTheme(): void {
  const [dark, setDark] = useState(() =>
    typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)').matches : false
  );
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'night' : 'day');
  }, [dark]);
}
