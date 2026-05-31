import { QueryClient } from '@tanstack/react-query';

/** react-query keeps the last successful data on refetch error → never-blank in-session.
 *  The service worker covers reload-with-server-down. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30_000, // ~30s poll (spec M2)
      refetchOnWindowFocus: true,
      retry: 2,
      staleTime: 10_000,
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
});
