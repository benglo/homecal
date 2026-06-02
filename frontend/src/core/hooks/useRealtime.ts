import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Some poke kinds fan out to additional query keys (e.g. a chore change also
 *  invalidates the per-day chore-board cache). Default = invalidate the kind itself. */
const KIND_TO_KEYS: Record<string, string[]> = {
  chores: ['chores', 'chore-board'],
  'family-members': ['family-members', 'chore-board'],
};

/** Subscribe to the backend SSE stream. Every poke invalidates the matching
 *  query family so the wall/phone refetch within a round-trip. EventSource
 *  reconnects natively; on (re)open we invalidate everything because a dropped
 *  connection may have missed pokes. The 30s poll (queryClient) is the backstop. */
export function useRealtime(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.addEventListener('poke', (e) => {
      try {
        const { kind } = JSON.parse((e as MessageEvent).data) as { kind: string };
        const keys = KIND_TO_KEYS[kind] ?? [kind];
        for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
      } catch {
        void qc.invalidateQueries();
      }
    });

    es.addEventListener('open', () => {
      void qc.invalidateQueries();
    });

    // EventSource handles reconnection itself; the poll covers any gap meanwhile.
    return () => es.close();
  }, [qc]);
}
