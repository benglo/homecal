import { useCallback, useRef } from 'react';
import { DateTime } from 'luxon';
import { ZONE } from '../../core/util/time';

export function useChimeSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  return useCallback(() => {
    const hour = DateTime.now().setZone(ZONE).hour;
    if (hour >= 20 || hour < 7) return;

    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }, []);
}
