import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

interface Props {
  children: ReactNode;
  onClick: () => void;
}

/** "Add X" button shown at the bottom of a manager section when no inline form
 *  is active. Outlined surface chip with accent text + leading Plus icon. */
export function InlineAddButton({ children, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md border border-border font-semibold"
      style={{
        marginTop: 10,
        padding: '10px 16px',
        fontSize: 14,
        background: 'var(--surface)',
        color: 'var(--accent)',
      }}
    >
      <Plus size={16} />
      {children}
    </button>
  );
}
