import { WallLayout } from './layouts/WallLayout';

/** Selects layout by explicit kiosk flag (?mode=wall), NOT viewport width.
 *  PhoneLayout (editing) arrives in M3; M2 is the read-only wall. */
export function ModeRouter() {
  return <WallLayout />;
}
