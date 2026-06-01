import { WallLayout } from './layouts/WallLayout';
import { PhoneLayout } from './layouts/PhoneLayout';
import { useIsWall } from './core/hooks/useIsWall';

export function ModeRouter() {
  const isWall = useIsWall();
  return isWall ? <WallLayout /> : <PhoneLayout />;
}
