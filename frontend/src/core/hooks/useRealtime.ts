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
type ReconnectHandler = () => void;

const KIND_TO_KEYS: Record<string, string[]> = {
  chores: ['chores', 'chore-board'],
  'family-members': ['family-members', 'chore-board'],
  dinners: ['dinners', 'dinner-suggestions'],
  voice: ['voice-status'],
};

const listeners = new Set<Handler>();
const reconnectHandlers = new Set<ReconnectHandler>();
let es: EventSource | null = null;
let connectCount = 0;
// Set to true after the initial `open`. Every subsequent `open` is a reconnect
// and triggers `reconnectHandlers` so subscribers can re-fetch state that may
// have changed during the gap (the 30s poll backstop alone misses up to 30s).
let hasOpened = false;

function ensureConnected(): void {
  if (es) return;
  hasOpened = false;
  es = new EventSource('/api/stream');
  es.addEventListener('open', () => {
    if (!hasOpened) {
      hasOpened = true;
      return;
    }
    for (const fn of [...reconnectHandlers]) {
      try {
        fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('useRealtime: reconnect handler threw', err);
      }
    }
  });
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
    hasOpened = false;
  }
}

/** Subscribe to the backend SSE stream. Every poke invalidates the matching
 *  query family so the wall/phone refetch within a round-trip. EventSource
 *  reconnects natively; on every reconnect we invalidate everything so any
 *  mutations that fired during the gap show up immediately. The 30s poll
 *  (queryClient) is the backstop. Multiple consumers share a single
 *  underlying EventSource via a module-scope singleton. */
export function useRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    ensureConnected();
    connectCount++;
    const onPoke: Handler = (poke) => {
      const keys = KIND_TO_KEYS[poke.kind] ?? [poke.kind];
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
    };
    const onReconnect: ReconnectHandler = () => {
      void qc.invalidateQueries();
    };
    listeners.add(onPoke);
    reconnectHandlers.add(onReconnect);
    return () => {
      listeners.delete(onPoke);
      reconnectHandlers.delete(onReconnect);
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
