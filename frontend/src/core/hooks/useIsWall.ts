const isWall = new URLSearchParams(window.location.search).get('mode') === 'wall';

export function useIsWall(): boolean {
  return isWall;
}
