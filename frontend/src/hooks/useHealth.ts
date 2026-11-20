import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  integrations: { payments: string; maps: string; sms: string; email: string };
  checks: { database: { ok: boolean; latencyMs: number }; redis: { ok: boolean; latencyMs: number } };
  uptimeSeconds: number;
  timestamp: string;
};

/**
 * Live API health. This is REAL data from /api/v1/health — it touches Postgres
 * and Redis on every call, so the badge cannot lie about the backend state.
 */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/**
 * Can this deployment actually send a text message?
 *
 * The API already answers this in its public health block (`integrations.sms` is
 * `TERMII` only when there is a key to send with). The browser needs it because
 * phone confirmation is optional and, with no SMS provider, it is also impossible —
 * offering a "Verify now" button that cannot work is worse than not offering it.
 *
 * `undefined` means we have not heard back yet, which is not the same as "no".
 */
export function useSmsReady(): boolean | undefined {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return data ? data.integrations.sms === 'TERMII' : undefined;
}
