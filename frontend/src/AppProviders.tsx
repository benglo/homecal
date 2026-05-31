import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './core/api/queryClient';
import { useRealtime } from './core/hooks/useRealtime';

/** Bridges the SSE stream to the query cache. Must live inside QueryClientProvider. */
function RealtimeBridge({ children }: { children: ReactNode }) {
  useRealtime();
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeBridge>{children}</RealtimeBridge>
    </QueryClientProvider>
  );
}
