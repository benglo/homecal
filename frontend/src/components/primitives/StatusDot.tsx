import { DateTime } from 'luxon';
import { ZONE } from '../../core/util/time';

/** Renders NOTHING when data is fresh — the ticking clock is the live signal.
 *  Shows an amber "last HH:mm" only when the cached payload is stale (> ~2 min). */
export function StatusDot({ dataUpdatedAt, isError }: { dataUpdatedAt: number; isError: boolean }) {
  if (!dataUpdatedAt) return null;
  const ageMs = Date.now() - dataUpdatedAt;
  const stale = isError || ageMs > 120_000;
  if (!stale) return null;
  const t = DateTime.fromMillis(dataUpdatedAt).setZone(ZONE).toFormat('HH:mm');
  return (
    <span className="inline-flex items-center gap-2 text-text-muted" style={{ fontSize: 16 }}>
      <span className="rounded-full" style={{ width: 11, height: 11, background: 'var(--stale)' }} />
      last {t}
    </span>
  );
}
