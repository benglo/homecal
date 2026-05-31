import { useEffect, useRef } from 'react';

/** Calls `onIdle` after `ms` with no pointer/touch/key activity, then re-arms.
 *  The wall uses this to return to its default view + today, so it's never left
 *  stuck on whatever someone last tapped (spec §0 / §8 IdleController). */
export function useIdleReset(ms: number, onIdle: () => void): void {
  const cb = useRef(onIdle);
  cb.current = onIdle;

  useEffect(() => {
    let timer = window.setTimeout(() => cb.current(), ms);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), ms);
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart', 'keydown'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [ms]);
}
