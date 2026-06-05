import type { DinnerSuggestion } from '../../core/model/types';

/** Case-insensitive contains filter over a list the server has already ranked.
 *  Empty / whitespace-only query → top N untouched. */
export function filterSuggestions(
  list: DinnerSuggestion[],
  query: string,
  limit: number,
): DinnerSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  const out: DinnerSuggestion[] = [];
  for (const s of list) {
    if (s.meal.toLowerCase().includes(q)) {
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}
