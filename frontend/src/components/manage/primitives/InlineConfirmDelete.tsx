import type { ReactNode } from 'react';
import { Button } from '../../primitives/Button';

interface Props {
  /** Warning text shown above the buttons (e.g. "Delete Mia? Her chores will be removed too."). */
  message: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/** Two-step destructive confirmation: a warning line followed by Delete / Cancel.
 *  Used inline beneath a ManagerRow so the row stays anchored while confirming. */
export function InlineConfirmDelete({ message, onConfirm, onCancel, busy = false }: Props) {
  return (
    <div style={{ padding: '0 12px 12px' }}>
      <p
        className="text-text-muted"
        style={{ fontSize: 13, marginBottom: 10 }}
        role="alert"
      >
        {message}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
