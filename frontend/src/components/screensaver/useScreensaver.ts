import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Photo } from '../../core/model/types';

const IDLE_MS = 5 * 60_000;

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ScreensaverState {
  active: boolean;
  queue: Photo[];
  index: number;
  advance: () => void;
  skipPhoto: (id: string) => void;
  dismiss: () => void;
}

export function useScreensaver(photos: Photo[] | undefined): ScreensaverState {
  const [active, setActive] = useState(false);
  const [queue, setQueue] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const timerRef = useRef(0);
  const qc = useQueryClient();

  const arm = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setActive(true), IDLE_MS);
  }, []);

  // When not active, listen for user interaction to reset the idle timer
  useEffect(() => {
    if (active) return;
    arm();
    const bump = () => arm();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [active, arm]);

  // On activation, build shuffled queue from current photo list
  useEffect(() => {
    if (!active) return;
    const list = photos ?? [];
    if (list.length === 0) {
      setActive(false);
      return;
    }
    setQueue(fisherYates(list));
    setIndex(0);
  }, [active, photos]);

  // Advance to next photo (cycles with reshuffle when exhausted)
  const advance = useCallback(() => {
    setIndex((i) => {
      const next = i + 1;
      if (next >= queue.length) {
        setQueue(fisherYates(queue));
        return 0;
      }
      return next;
    });
  }, [queue]);

  // Remove a broken photo from the queue
  const skipPhoto = useCallback((id: string) => {
    setQueue((q) => {
      const filtered = q.filter((p) => p.id !== id);
      if (filtered.length === 0) {
        setActive(false);
        arm();
        return [];
      }
      return filtered;
    });
    setIndex((i) => Math.min(i, queue.length - 2));
  }, [queue.length, arm]);

  // Dismiss the screensaver, re-arm idle timer, invalidate cache
  const dismiss = useCallback(() => {
    setActive(false);
    setQueue([]);
    setIndex(0);
    arm();
    void qc.invalidateQueries();
  }, [qc, arm]);

  return { active, queue, index, advance, skipPhoto, dismiss };
}
