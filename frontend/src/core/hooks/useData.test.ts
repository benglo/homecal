/**
 * useData hook tests — pure-logic subset.
 *
 * This workspace does not ship `@testing-library/react` + jsdom so React
 * hooks cannot be rendered here (see useBrisbaneDate.test.ts for the same
 * constraint documented in detail).  The load-bearing logic to verify is:
 *
 *  - `api.voiceConcerns` builds the correct URL with / without the `since` param
 *  - `useRecentConcerns` is exported (TypeScript confirms the shape at compile time)
 *
 * Anything that requires the React QueryClient lifecycle (the staleTime,
 * the actual network fetch, the queryKey de-duplication) is covered by
 * integration / E2E tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api/client';

// ---------------------------------------------------------------------------
// api.voiceConcerns — URL construction
// ---------------------------------------------------------------------------

describe('api.voiceConcerns', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls /api/voice/concerns with no query string when since is omitted', async () => {
    const fetched: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      fetched.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    });

    await api.voiceConcerns();
    expect(fetched[0]).toBe('/api/voice/concerns');
  });

  it('appends ?since=<encoded> when a since param is provided', async () => {
    const fetched: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      fetched.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    });

    await api.voiceConcerns('2026-06-01T00:00:00Z');
    expect(fetched[0]).toContain('/api/voice/concerns?since=');
    expect(fetched[0]).toContain('2026-06-01');
  });
});

// ---------------------------------------------------------------------------
// useRecentConcerns — export smoke-test (TypeScript enforces the shape)
// ---------------------------------------------------------------------------

import { useRecentConcerns } from './useData';

describe('useRecentConcerns', () => {
  it('is exported as a function', () => {
    expect(typeof useRecentConcerns).toBe('function');
  });
});
