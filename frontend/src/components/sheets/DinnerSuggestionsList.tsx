import type { DinnerSuggestion } from '../../core/model/types';

interface Props {
  items: DinnerSuggestion[];
  onPick: (meal: string) => void;
  /** True when the input is empty (heading reads "Recent meals" vs "Matches"). */
  isEmptyQuery: boolean;
}

/** Typeahead suggestion list shown under the meal input. Flows inside the
 *  Sheet body's existing scroll (no fixed max-height) so the virtual keyboard
 *  shrinks the visible area cleanly via Sheet's var(--kb-height) math. */
export function DinnerSuggestionsList({ items, onPick, isEmptyQuery }: Props) {
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <p
        className="text-text-faint"
        style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}
      >
        {isEmptyQuery ? 'Recent meals' : 'Matches'}
      </p>
      <ul className="flex flex-col">
        {items.map((s) => (
          <li key={s.meal}>
            <button
              type="button"
              onClick={() => onPick(s.meal)}
              className="flex items-center justify-between w-full text-left rounded-md"
              style={{
                padding: '12px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                marginBottom: 8,
                fontSize: 15,
                color: 'var(--text)',
                minHeight: 48,
              }}
            >
              <span className="truncate" style={{ minWidth: 0 }}>{s.meal}</span>
              <span className="shrink-0 text-text-faint" style={{ fontSize: 12, marginLeft: 12 }}>
                ×{s.count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
