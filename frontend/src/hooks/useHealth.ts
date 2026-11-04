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
