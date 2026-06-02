import type { QueryClient } from '@tanstack/react-query';

/** Apply an optimistic in-place patch to every cached query matching `queryKey`.
 *  Returns a `rollback()` thunk that restores the pre-patch snapshots — pair it
 *  with React Query's `onMutate` → `onError` flow.
 *
 *  Does NOT cancel queries; the caller does that first (we don't want to swallow
 *  the `await qc.cancelQueries(...)` Promise into a sync helper).
 *
 *  `transform` only runs for snapshots whose data is defined; undefined snapshots
 *  are still recorded so rollback restores the absent-data state correctly. */
export function optimisticPatch<T>(
  qc: QueryClient,
  queryKey: readonly unknown[],
  transform: (data: T) => T,
): { rollback: () => void } {
  const snapshots = qc.getQueriesData<T>({ queryKey });
  for (const [key, data] of snapshots) {
    if (data !== undefined) qc.setQueryData<T>(key, transform(data));
  }
  return {
    rollback: () => {
      for (const [key, data] of snapshots) qc.setQueryData(key, data);
    },
  };
}
