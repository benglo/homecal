import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

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
        void qc.invalidateQueries({ queryKey: [kind] });
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
