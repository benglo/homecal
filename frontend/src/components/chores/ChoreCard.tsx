import { useEffect, useRef, useState } from 'react';
import { StarBurst } from './StarBurst';

interface Props {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  onComplete: () => void;
  starTargetRef: React.RefObject<HTMLElement | null>;
}

export function ChoreCard({ id, title, icon, stars, completed, onComplete, starTargetRef }: Props) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [bursting, setBursting] = useState(false);
  void id;

  useEffect(() => {
    if (!bursting) return;
    const timer = setTimeout(() => setBursting(false), 1000);
    return () => clearTimeout(timer);
  }, [bursting]);

  const handleClick = () => {
    setBursting(true);
    onComplete();
  };

  return (
    <>
      <button
        ref={cardRef}
        type="button"
        disabled={completed}
        onClick={completed ? undefined : handleClick}
        className="flex items-center w-full text-left transition-all"
        style={{
          minHeight: 120,
          padding: '16px 20px',
          borderRadius: 16,
          gap: 16,
          border: completed ? '1px solid rgba(34,197,94,0.25)' : '1px solid var(--border)',
          background: completed ? 'rgba(34,197,94,0.12)' : 'var(--surface)',
          opacity: completed ? 0.75 : 1,
          cursor: completed ? 'default' : 'pointer',
          animation: completed ? 'choreCardPop 0.6s ease-out' : undefined,
        }}
      >
        <span style={{ fontSize: 48, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
        <span className="flex-1 min-w-0">
          <span
            className="block font-semibold"
            style={{
              fontSize: 22,
              color: completed ? 'var(--text-muted)' : 'var(--text)',
              textDecoration: completed ? 'line-through' : undefined,
            }}
          >
            {title}
          </span>
        </span>
        <span style={{ fontSize: 20, flexShrink: 0 }}>
          {completed && <span style={{ fontSize: 36, marginRight: 8 }}>✅</span>}
          {'⭐'.repeat(stars)}
        </span>
      </button>
      <StarBurst active={bursting} originRef={cardRef} targetRef={starTargetRef} count={stars} />
    </>
  );
}
