/** In-process pub/sub for "data changed" pokes. The SSE route (`/api/stream`)
 *  subscribes; mutation routes call `poke()` so every connected client refetches.
 *  LAN, single process, single in-memory connection — a Set of listeners is plenty. */

export type PokeKind = 'events' | 'dinners' | 'categories' | 'photos' | 'chores' | 'family-members';

export interface Poke {
  kind: PokeKind;
  at: string; // ISO-8601 UTC, server-stamped
}

type Listener = (poke: Poke) => void;

export interface Broker {
  subscribe(fn: Listener): () => void;
  poke(kind: PokeKind): void;
  size(): number;
}

export function createBroker(): Broker {
  const listeners = new Set<Listener>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    poke(kind) {
      const event: Poke = { kind, at: new Date().toISOString() };
      // Snapshot so a listener that unsubscribes during delivery can't mutate the set
      // mid-iteration; isolate failures so one dead connection can't drop the rest.
      for (const fn of [...listeners]) {
        try {
          fn(event);
        } catch {
          /* a broken SSE pipe must not block other subscribers */
        }
      }
    },
    size: () => listeners.size,
  };
}

/** The process-wide broker shared by the SSE route and the mutation routes. */
export const broker = createBroker();
