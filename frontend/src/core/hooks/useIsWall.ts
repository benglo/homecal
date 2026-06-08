// Evaluated once at module load; safe in non-browser environments (e.g. vitest/node).
const isWall =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mode') === 'wall';

export function useIsWall(): boolean {
  return isWall;
}
