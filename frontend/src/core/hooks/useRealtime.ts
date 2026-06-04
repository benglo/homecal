import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Some poke kinds fan out to additional query keys (e.g. a chore change also
 *  invalidates the per-day chore-board cache). Default = invalidate the kind itself. */
interface Poke {
  kind: string;
  at: string;
  payload?: unknown;
}
type Handler = (p: Poke) => void;

const KIND_TO_KEYS: Record<string, string[]> = {
  chores: ['chores', 'chore-board'],
  'family-members': ['family-members', 'chore-board'],
  dinners: ['dinners', 'dinner-suggestions'],
  voice: ['voice-status'],
};

const listeners = new Set<Handler>();
let es: EventSource | null = null;
let connectCount = 0;

function ensureConnected(): void {
  if (es) return;
  es = new EventSource('/api/stream');
  es.addEventListener('poke', (e) => {
    let poke: Poke;
    try {
      poke = JSON.parse((e as MessageEvent).data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('useRealtime: malformed SSE poke payload', err);
      return;
    }
    for (const fn of [...listeners]) {
      try {
        fn(poke);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('useRealtime: listener threw on poke', { kind: poke.kind, err });
      }
    }
  });
}

function maybeClose(): void {
  if (connectCount === 0 && listeners.size === 0 && es) {
    es.close();
    es = null;
  }
}

/** Subscribe to the backend SSE stream. Every poke invalidates the matching
 *  query family so the wall/phone refetch within a round-trip. EventSource
 *  reconnects natively; the 30s poll (queryClient) is the backstop. Multiple
 *  consumers share a single underlying EventSource via a module-scope singleton. */
export function useRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    ensureConnected();
    connectCount++;
    const onPoke: Handler = (poke) => {
      const keys = KIND_TO_KEYS[poke.kind] ?? [poke.kind];
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
    };
    listeners.add(onPoke);
    return () => {
      listeners.delete(onPoke);
      connectCount--;
      maybeClose();
    };
  }, [qc]);
}

/** Subscribe a typed payload handler for a specific kind (used by VoiceOverlay). */
export function useSsePoke<T = unknown>(
  kind: string,
  cb: (payload: T, poke: Poke) => void,
): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    ensureConnected();
    connectCount++;
    const h: Handler = (poke) => {
      if (poke.kind === kind) cbRef.current(poke.payload as T, poke);
    };
    listeners.add(h);
    return () => {
      listeners.delete(h);
      connectCount--;
      maybeClose();
    };
  }, [kind]);
}
