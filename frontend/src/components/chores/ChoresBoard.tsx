import { useChoreBoard } from '../../core/hooks/useData';
import { useChoreCompletion } from '../../core/hooks/useMutations';
import { useBrisbaneDate } from '../../core/hooks/useBrisbaneDate';
import { useChimeSound } from './useChimeSound';
import { MemberColumn } from './MemberColumn';

export function ChoresBoard() {
  const date = useBrisbaneDate();
  const boardQ = useChoreBoard(date);
  const { complete } = useChoreCompletion();
  const playChime = useChimeSound();

  const board = boardQ.data;

  const handleComplete = (choreId: string) => {
    playChime();
    complete.mutate({ choreId, date });
  };

  if (!board || board.members.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center" style={{ gap: 12, flexDirection: 'column' }}>
        <span style={{ fontSize: 64 }}>📱</span>
        <span style={{ fontSize: 22, color: 'var(--text-muted)' }}>Set up family members on your phone</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-x-auto" style={{ borderTop: '1px solid var(--border)' }}>
      {board.members.map((member, i) => (
        <div
          key={member.id}
          className="flex"
          style={{
            flex: board.members.length === 1 ? 'none' : 1,
            maxWidth: board.members.length === 1 ? 500 : undefined,
            margin: board.members.length === 1 ? '0 auto' : undefined,
            borderRight: i < board.members.length - 1 ? '1px solid var(--border)' : undefined,
          }}
        >
          <MemberColumn member={member} onComplete={handleComplete} />
        </div>
      ))}
    </div>
  );
}
