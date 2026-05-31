import { WallLayout } from './layouts/WallLayout';
import { PhoneLayout } from './layouts/PhoneLayout';

/** Selects layout by explicit kiosk flag (?mode=wall), NOT viewport width
 *  (the Pi reports 1280×800, which a width breakpoint would mis-bucket). */
export function ModeRouter() {
  const isWall = new URLSearchParams(window.location.search).get('mode') === 'wall';
  return isWall ? <WallLayout /> : <PhoneLayout />;
}
