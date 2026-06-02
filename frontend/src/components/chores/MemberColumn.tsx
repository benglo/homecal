import { useRef } from 'react';
import type { BoardMember } from '../../core/model/types';
import { ChoreCard } from './ChoreCard';

interface Props {
  member: BoardMember;
  onComplete: (choreId: string) => void;
}

export function MemberColumn({ member, onComplete }: Props) {
  const starCountRef = useRef<HTMLDivElement>(null);
  const allDone = member.chores.length > 0 && member.chores.every((c) => c.completed);
  const noChores = member.chores.length === 0;

  return (
    <div className="flex flex-col" style={{ minWidth: 280, flex: 1, padding: '20px 24px' }}>
      <div className="text-center" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 72, lineHeight: 1, display: 'block' }}>{member.icon}</span>
        <div style={{ fontSize: 18, color: 'var(--text-muted)', marginTop: 4 }}>{member.name}</div>
        <div ref={starCountRef} style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24', marginTop: 4 }}>
          ⭐ {member.totalStars}
        </div>
      </div>

      {noChores && (
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ gap: 8, opacity: 0.6 }}>
          <span style={{ fontSize: 48 }}>😊</span>
          <span style={{ fontSize: 18 }}>No chores today</span>
        </div>
      )}

      {allDone && (
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ gap: 12 }}>
          <span style={{ fontSize: 80, animation: 'choreCardPop 1s ease infinite' }}>🎉</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: '#fbbf24' }}>All done!</span>
        </div>
      )}

      {!allDone && !noChores && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {member.chores.map((chore) => (
            <ChoreCard
              key={chore.id}
              id={chore.id}
              title={chore.title}
              icon={chore.icon}
              stars={chore.stars}
              completed={chore.completed}
              onComplete={() => onComplete(chore.id)}
              starTargetRef={starCountRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}
