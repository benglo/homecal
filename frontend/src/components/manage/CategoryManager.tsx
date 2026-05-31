import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Category } from '../../core/model/types';
import { useCategoryMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { CategoryChip } from '../primitives/CategoryChip';
import { Button } from '../primitives/Button';

interface Props {
  categories: Category[];
  onEdit: (category: Category) => void;
}

const UNCATEGORIZED = 'Uncategorized';

/** Manage-tab list of categories: edit (→ sheet) + delete. Delete is blocked (409
 *  CATEGORY_IN_USE) when events reference it — we explain why and offer a one-tap
 *  "move them to Uncategorized & delete" (spec §4.2), rather than a dead-end error. */
export function CategoryManager({ categories, onEdit }: Props) {
  const { remove, reassign } = useCategoryMutations();
  const [blocked, setBlocked] = useState<{ id: string; message: string } | null>(null);

  const uncategorized = categories.find((c) => c.name === UNCATEGORIZED);

  const del = (c: Category) => {
    setBlocked(null);
    remove.mutate(c.id, {
      onError: (err) =>
        setBlocked({
          id: c.id,
          message: err instanceof ApiError ? err.message : 'Could not delete this category.',
        }),
    });
  };

  const reassignThenDelete = (c: Category) => {
    if (!uncategorized) return;
    reassign.mutate(
      { id: c.id, toId: uncategorized.id },
      { onSuccess: () => del(c) }
    );
  };

  return (
    <section>
      <h2 className="font-semibold text-text-muted" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        Categories
      </h2>
      <ul className="flex flex-col gap-2">
        {categories.map((c) => {
          const canReassign = blocked?.id === c.id && !!uncategorized && uncategorized.id !== c.id;
          return (
            <li key={c.id} className="rounded-md border border-border" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center gap-3" style={{ padding: '10px 12px' }}>
                <div className="flex-1 min-w-0">
                  <CategoryChip category={c} size="phone" />
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(c)}
                  aria-label={`Edit ${c.name}`}
                  className="grid place-items-center rounded-md text-text-muted"
                  style={{ width: 48, height: 48 }}
                >
                  <Pencil size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => del(c)}
                  aria-label={`Delete ${c.name}`}
                  className="grid place-items-center rounded-md"
                  style={{ width: 48, height: 48, color: 'var(--stale)' }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              {blocked?.id === c.id && (
                <div style={{ padding: '0 12px 12px' }}>
                  <p className="text-text-muted" style={{ fontSize: 13, marginBottom: canReassign ? 10 : 0 }} role="alert">
                    {blocked.message}
                    {canReassign && <> — or move them to <strong>Uncategorized</strong> in one tap:</>}
                  </p>
                  {canReassign && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={() => reassignThenDelete(c)} disabled={reassign.isPending || remove.isPending}>
                        Move to Uncategorized &amp; delete
                      </Button>
                      <Button variant="ghost" onClick={() => setBlocked(null)}>
                        Keep
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
