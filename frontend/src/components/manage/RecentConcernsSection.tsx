import { DateTime } from 'luxon';
import { useRecentConcerns } from '../../core/hooks/useData';
import { ZONE } from '../../core/util/time';
import { SectionHeading } from './primitives/SectionHeading';

/** Concerning kid-utterances flagged by Haiku (concern=true), surfaced for
 *  parental review. Last 7 days. Read-only — no mark-as-reviewed flow in v1.
 *  Spec §7.3. */
export function RecentConcernsSection() {
  const { data, isLoading } = useRecentConcerns();
  if (isLoading) return null;
  const rows = data ?? [];

  return (
    <section style={{ marginTop: 24 }}>
      <SectionHeading>Recent voice concerns</SectionHeading>
      <p
        className="text-text-muted"
        style={{ fontSize: 13, marginBottom: 12 }}
      >
        Things the kids asked that the bot flagged as worth your eyes. Last 7 days.
      </p>
      {rows.length === 0 ? (
        <p className="text-text-muted" style={{ fontSize: 13 }}>
          No recent concerns.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              className="rounded-md border border-border"
              style={{ background: 'var(--surface)', padding: 12 }}
            >
              <div
                className="text-text-muted"
                style={{ fontSize: 12 }}
              >
                {DateTime.fromISO(r.createdAt).setZone(ZONE).toFormat('d LLL h:mma')}
              </div>
              <div
                className="font-semibold text-text"
                style={{ marginTop: 6, fontSize: 15 }}
              >
                {r.transcript}
              </div>
              {r.answer && (
                <div
                  className="text-text-muted"
                  style={{ marginTop: 4, fontSize: 13 }}
                >
                  → {r.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
