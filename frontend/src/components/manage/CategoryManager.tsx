import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Category } from '../../core/model/types';
import { useCategoryMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { CategoryChip } from '../primitives/CategoryChip';

interface Props {
  categories: Category[];
  onEdit: (category: Category) => void;
}

/** Manage-tab list of categories: edit (→ sheet) + delete. Delete is blocked with a
 *  409 (CATEGORY_IN_USE) when events reference it — we surface the count inline. */
export function CategoryManager({ categories, onEdit }: Props) {
  const { remove } = useCategoryMutations();
  const [blocked, setBlocked] = useState<{ id: string; message: string } | null>(null);

  const del = (c: Category) => {
    setBlocked(null);
    remove.mutate(c.id, {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'CATEGORY_IN_USE') {
          setBlocked({ id: c.id, message: err.message });
        } else {
          setBlocked({ id: c.id, message: err instanceof ApiError ? err.message : 'Could not delete.' });
        }
      },
    });
  };

  return (
    <section>
      <h2 className="font-semibold text-text-muted" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        Categories
      </h2>
      <ul className="flex flex-col gap-2">
        {categories.map((c) => (
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
                style={{ width: 40, height: 40 }}
              >
                <Pencil size={18} />
              </button>
              <button
                type="button"
                onClick={() => del(c)}
                aria-label={`Delete ${c.name}`}
                className="grid place-items-center rounded-md"
                style={{ width: 40, height: 40, color: 'var(--stale)' }}
              >
                <Trash2 size={18} />
              </button>
            </div>
            {blocked?.id === c.id && (
              <p className="text-stale" style={{ padding: '0 12px 10px', fontSize: 13 }} role="alert">
                {blocked.message}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
