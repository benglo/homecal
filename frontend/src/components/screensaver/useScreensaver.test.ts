import { describe, it, expect } from 'vitest';

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('fisherYates', () => {
  it('returns all elements (no duplicates, no missing)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = fisherYates(input);
    expect(result).toHaveLength(input.length);
    expect(new Set(result)).toEqual(new Set(input));
  });

  it('does not mutate the original array', () => {
    const input = [1, 2, 3];
    const copy = [...input];
    fisherYates(input);
    expect(input).toEqual(copy);
  });

  it('handles single element', () => {
    expect(fisherYates([42])).toEqual([42]);
  });

  it('handles empty array', () => {
    expect(fisherYates([])).toEqual([]);
  });
});
