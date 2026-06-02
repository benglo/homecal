import { useEffect, useState } from 'react';

interface StarParticle {
  id: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

interface Props {
  active: boolean;
  originRef: React.RefObject<HTMLElement | null>;
  targetRef: React.RefObject<HTMLElement | null>;
  count?: number;
}

export function StarBurst({ active, originRef, targetRef, count = 3 }: Props) {
  const [particles, setParticles] = useState<StarParticle[]>([]);

  useEffect(() => {
    if (!active || !originRef.current || !targetRef.current) return;
    const origin = originRef.current.getBoundingClientRect();
    const target = targetRef.current.getBoundingClientRect();
    const cx = origin.left + origin.width / 2;
    const cy = origin.top + origin.height / 2;
    const tx = target.left + target.width / 2;
    const ty = target.top + target.height / 2;

    setParticles(
      Array.from({ length: count }, (_, i) => ({
        id: Date.now() + i,
        startX: cx + (Math.random() - 0.5) * 40,
        startY: cy,
        dx: tx - cx + (Math.random() - 0.5) * 20,
        dy: ty - cy,
      }))
    );
    const timer = setTimeout(() => setParticles([]), 900);
    return () => clearTimeout(timer);
  }, [active, originRef, targetRef, count]);

  return (
    <>
      {particles.map((p) => (
        <span
          key={p.id}
          className="fixed pointer-events-none text-2xl"
          style={{
            left: p.startX,
            top: p.startY,
            animation: 'starFly 0.8s ease-out forwards',
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
          } as React.CSSProperties}
        >
          ⭐
        </span>
      ))}
    </>
  );
}
