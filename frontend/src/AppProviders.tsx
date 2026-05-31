import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './core/api/queryClient';
import { useRealtime } from './core/hooks/useRealtime';
import { ErrorBoundary } from './components/primitives/ErrorBoundary';

/** Bridges the SSE stream to the query cache. Must live inside QueryClientProvider. */
function RealtimeBridge({ children }: { children: ReactNode }) {
  useRealtime();
  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RealtimeBridge>{children}</RealtimeBridge>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
