import { describe, it, expect } from 'vitest';
import { filterSuggestions } from './dinnerSuggestions';
import type { DinnerSuggestion } from '../../core/model/types';

const list: DinnerSuggestion[] = [
  { meal: 'Spaghetti Bolognese', count: 8, lastUsed: '2026-05-30T00:00:00Z' },
  { meal: 'Chicken Curry',       count: 5, lastUsed: '2026-05-29T00:00:00Z' },
  { meal: 'Tacos',               count: 4, lastUsed: '2026-05-28T00:00:00Z' },
  { meal: 'Pumpkin Soup',        count: 1, lastUsed: '2026-05-01T00:00:00Z' },
];

describe('filterSuggestions', () => {
  it('returns the top N (by input order) on an empty query', () => {
    expect(filterSuggestions(list, '', 2)).toEqual([list[0], list[1]]);
  });

  it('matches case-insensitively', () => {
    expect(filterSuggestions(list, 'CURRY', 10).map((s) => s.meal)).toEqual(['Chicken Curry']);
  });

  it('does fuzzy contains, not just starts-with', () => {
    expect(filterSuggestions(list, 'curry', 10).map((s) => s.meal)).toEqual(['Chicken Curry']);
    expect(filterSuggestions(list, 'soup', 10).map((s) => s.meal)).toEqual(['Pumpkin Soup']);
  });

  it('preserves input order (already frequency-sorted by the server)', () => {
    expect(filterSuggestions(list, 'a', 10).map((s) => s.meal)).toEqual([
      'Spaghetti Bolognese',
      'Tacos',
    ]);
  });

  it('trims whitespace and ignores blank queries', () => {
    expect(filterSuggestions(list, '   ', 3)).toEqual(list.slice(0, 3));
  });

  it('returns [] when nothing matches', () => {
    expect(filterSuggestions(list, 'zzz', 10)).toEqual([]);
  });
});
