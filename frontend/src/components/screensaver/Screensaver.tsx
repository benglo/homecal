import { useEffect, useRef, useState, useCallback } from 'react';
import { DateTime } from 'luxon';
import { ZONE } from '../../core/util/time';
import type { Photo } from '../../core/model/types';

interface Props {
  queue: Photo[];
  index: number;
  advance: () => void;
  skipPhoto: (id: string) => void;
  dismiss: () => void;
}

const REDUCED_MOTION =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function randomKenBurns(isPortrait: boolean): { from: string; to: string } {
  if (REDUCED_MOTION) return { from: 'scale3d(1,1,1) translate3d(0,0,0)', to: 'scale3d(1,1,1) translate3d(0,0,0)' };
  const scaleMin = isPortrait ? 1.02 : 1.05;
  const scaleMax = isPortrait ? 1.05 : 1.15;
  const s = scaleMin + Math.random() * (scaleMax - scaleMin);
  const txMax = isPortrait ? 2 : 5;
  const tyMax = isPortrait ? 5 : 3;
  const tx = (Math.random() * txMax * 2 - txMax).toFixed(2);
  const ty = (Math.random() * tyMax * 2 - tyMax).toFixed(2);
  return {
    from: `scale3d(${s.toFixed(3)},${s.toFixed(3)},1) translate3d(0%,0%,0)`,
    to: `scale3d(${s.toFixed(3)},${s.toFixed(3)},1) translate3d(${tx}%,${ty}%,0)`,
  };
}

function displayMs(count: number): number {
  if (count === 1) return 30_000;
  if (count <= 3) return 20_000;
  return 10_000;
}

export function Screensaver({ queue, index, advance, skipPhoto, dismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [front, setFront] = useState<0 | 1>(0);
  const [clockNow, setClockNow] = useState(() => DateTime.now().setZone(ZONE));

  const imgRefs = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)];
  const advanceTimer = useRef(0);
  const errorTimer = useRef(0);

  const current = queue[index] as Photo | undefined;

  // Fade in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Clock tick every second
  useEffect(() => {
    const id = setInterval(() => setClockNow(DateTime.now().setZone(ZONE)), 1_000);
    return () => clearInterval(id);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(advanceTimer.current);
      clearTimeout(errorTimer.current);
    };
  }, []);

  const handleSwap = useCallback(() => {
    // Freeze outgoing buffer: read computed transform, set as static, fade out
    const outgoing = imgRefs[front].current;
    if (outgoing) {
      const computed = getComputedStyle(outgoing).transform;
      outgoing.style.transition = 'none';
      outgoing.style.transform = computed;
      // Force reflow then fade out
      void outgoing.offsetHeight;
      outgoing.style.transition = 'opacity 1s ease';
      outgoing.style.opacity = '0';
    }
    // Swap front and advance
    setFront((f) => (f === 0 ? 1 : 0) as 0 | 1);
    advance();
  }, [front, advance]);

  // Load current photo into the front buffer
  useEffect(() => {
    if (!current) return;

    const img = imgRefs[front].current;
    if (!img) return;

    clearTimeout(advanceTimer.current);
    clearTimeout(errorTimer.current);

    // Set up error/timeout fallback
    errorTimer.current = window.setTimeout(() => skipPhoto(current.id), 8_000);

    const onError = () => {
      clearTimeout(errorTimer.current);
      skipPhoto(current.id);
    };

    const onLoad = () => {
      clearTimeout(errorTimer.current);

      // Detect portrait
      const isPortrait = img.naturalHeight > img.naturalWidth;
      const kb = randomKenBurns(isPortrait);

      // Set initial transform (no transition)
      img.style.transition = 'none';
      img.style.transform = kb.from;
      img.style.opacity = '1';
      // Force reflow
      void img.offsetHeight;

      // Animate Ken Burns
      const duration = displayMs(queue.length);
      img.style.transition = `transform ${duration}ms linear, opacity 1s ease`;
      img.style.transform = kb.to;

      // Preload next photo
      const nextIdx = (index + 1) % queue.length;
      if (queue.length > 1) {
        const preload = new Image();
        preload.src = queue[nextIdx].url;
      }

      // Schedule advance
      advanceTimer.current = window.setTimeout(handleSwap, duration);
    };

    img.onload = onLoad;
    img.onerror = onError;
    img.src = current.url;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, front]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(dismiss, 300);
  }, [dismiss]);

  return (
    <div
      onPointerDown={handleDismiss}
      onTouchStart={handleDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: '#000',
        cursor: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Dual image buffers */}
      {([0, 1] as const).map((i) => (
        <img
          key={i}
          ref={imgRefs[i]}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            willChange: 'transform',
            opacity: i === front ? 1 : 0,
            zIndex: i === front ? 1 : 0,
          }}
        />
      ))}

      {/* Gradient scrim */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '25%',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.55))',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />

      {/* Clock overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          zIndex: 3,
          color: '#fff',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 300,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.1,
          }}
        >
          {clockNow.toFormat('h:mm')}
        </div>
        <div
          style={{
            fontSize: 16,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {clockNow.toFormat('EEEE d LLLL')}
        </div>
      </div>
    </div>
  );
}
