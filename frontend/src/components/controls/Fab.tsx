import { Plus } from 'lucide-react';

interface Props {
  onClick: () => void;
  label: string;
}

/** Phone primary create action: floating + above the TabBar, safe-area aware. */
export function Fab({ onClick, label }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="fixed grid place-items-center rounded-full z-40"
      style={{
        width: 56,
        height: 56,
        right: 18,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
        background: 'var(--accent)',
        color: '#fff',
        boxShadow: 'var(--shadow)',
      }}
    >
      <Plus size={26} strokeWidth={2.4} />
    </button>
  );
}
