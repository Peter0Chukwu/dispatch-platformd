import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Server-state policy for the whole app:
 *  · retry twice on network/5xx errors, never on 4xx (a 404 will stay a 404)
 *  · one automatic refetch on reconnect — riders lose signal constantly
 *  · no refetch-on-focus storms on mobile; we refetch on reconnect instead
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: 0 },
  },
});
