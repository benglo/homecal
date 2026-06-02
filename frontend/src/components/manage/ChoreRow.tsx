import { Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { Chore } from '../../core/model/types';
import { ManagerRow } from './primitives/ManagerRow';
import { InlineConfirmDelete } from './primitives/InlineConfirmDelete';

const DOW_SHORT: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

interface Props {
  chore: Chore;
  canUp: boolean;
  canDown: boolean;
  reorderPending: boolean;
  removePending: boolean;
  /** When set, replaces the row's body with the two-step delete confirmation. */
  isConfirming: boolean;
  /** Inline error message for this row (e.g. "Could not delete — try again."). */
  errorMessage: string | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/** Single chore row — icon tile + title + (stars + frequency badge) + up/down/edit/delete.
 *  Built on top of ManagerRow so all manage lists share the same row chrome. */
export function ChoreRow({
  chore,
  canUp,
  canDown,
  reorderPending,
  removePending,
  isConfirming,
  errorMessage,
  onMoveUp,
  onMoveDown,
  onEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: Props) {
  const frequencyLabel =
    chore.frequency === 'daily'
      ? 'Daily'
      : chore.dayOfWeek != null
        ? DOW_SHORT[chore.dayOfWeek]
        : 'Weekly';

  return (
    <ManagerRow
      leading={
        <span
          className="grid place-items-center shrink-0 rounded-md"
          style={{ width: 36, height: 36, fontSize: 20, background: 'var(--surface-2)' }}
          aria-hidden
        >
          {chore.icon || '✅'}
        </span>
      }
      title={chore.title}
      subtitle={
        <>
          <span aria-label={`${chore.stars} stars`}>
            {'⭐'.repeat(Math.max(1, Math.min(5, chore.stars)))}
          </span>
          <span
            className="rounded-md"
            style={{
              padding: '2px 8px',
              background: 'var(--surface-2)',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            {frequencyLabel}
          </span>
        </>
      }
      actions={
        <>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canUp || reorderPending}
            aria-label={`Move ${chore.title} up`}
            className="grid place-items-center rounded-md text-text-muted disabled:opacity-30"
            style={{ width: 40, height: 40 }}
          >
            <ChevronUp size={18} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canDown || reorderPending}
            aria-label={`Move ${chore.title} down`}
            className="grid place-items-center rounded-md text-text-muted disabled:opacity-30"
            style={{ width: 40, height: 40 }}
          >
            <ChevronDown size={18} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${chore.title}`}
            className="grid place-items-center rounded-md text-text-muted"
            style={{ width: 44, height: 44 }}
          >
            <Pencil size={18} />
          </button>
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label={`Delete ${chore.title}`}
            className="grid place-items-center rounded-md"
            style={{ width: 44, height: 44, color: 'var(--stale)' }}
          >
            <Trash2 size={18} />
          </button>
        </>
      }
    >
      {isConfirming && (
        <InlineConfirmDelete
          message={<>Delete <strong>{chore.title}</strong>?</>}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
          busy={removePending}
        />
      )}
      {errorMessage && !isConfirming && (
        <div style={{ padding: '0 12px 12px' }}>
          <p
            className="text-text-muted"
            style={{ fontSize: 13, color: 'var(--stale)' }}
            role="alert"
          >
            {errorMessage}
          </p>
        </div>
      )}
    </ManagerRow>
  );
}
