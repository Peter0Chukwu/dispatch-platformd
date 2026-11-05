import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { downloadFile } from '../lib/download';

/**
 * REPORTS (Phase 9)
 *
 * Requesting a report queues a job; the file appears when the worker has rendered
 * it. So the list query polls — but only while something is queued or processing.
 * A dashboard that polls forever for no reason is a dashboard that heats a laptop.
 */

export type ReportFormat = 'CSV' | 'PDF';

export interface ReportCatalogueEntry {
  type: string;
  title: string;
  description: string;
  formats: ReportFormat[];
}

export interface ReportJob {
  id: string;
  type: string;
  format: ReportFormat;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  period: { from: string | null; to: string | null };
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
  downloadable: boolean;
  download?: { url: string; expiresAt: string; fileName: string } | null;
}

export interface ReportPreview {
  type: string;
  title: string;
  subtitle: string;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right'; money?: boolean }>;
  rows: Array<Record<string, string | number | null>>;
  totalsFormatted: Array<{ label: string; value: string; display: string }>;
  truncated?: { shown: number; total: number };
}

export function useReportCatalogue() {
  return useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: () => api.get<{ data: ReportCatalogueEntry[] }>('/admin/reports/catalogue').then((res) => res.data),
    staleTime: 10 * 60_000,
  });
}

export function useReportJobs() {
  return useQuery({
    queryKey: ['reports', 'jobs'],
    queryFn: () => api.get<{ data: ReportJob[] }>('/admin/reports?limit=20').then((res) => res.data),
    // Poll only while the worker still owes us something.
    refetchInterval: (query) => {
      const jobs: ReportJob[] = query.state.data ?? [];
      return jobs.some((job) => job.status === 'QUEUED' || job.status === 'PROCESSING') ? 2000 : false;
    },
  });
}

export function useReportPreview(type: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['reports', 'preview', type, from, to],
    queryFn: () =>
      api.get<ReportPreview>(
        `/admin/reports/preview?type=${encodeURIComponent(type!)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: Boolean(type),
    retry: false,
  });
}

export function useRequestReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; format: ReportFormat; from: string; to: string }) =>
      api.post<ReportJob>('/admin/reports', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reports', 'jobs'] });
    },
  });
}

/**
 * Ask the API for a fresh signed link, then save the file.
 *
 * The token is minted server-side, expires in 15 minutes, and is the only thing in
 * the URL — so the download itself needs no session and cannot be guessed.
 */
export async function downloadReport(id: string): Promise<string> {
  const link = await api.post<{ url: string; fileName: string }>(`/admin/reports/${id}/download-link`);
  // Strip the API prefix: the helper adds it back and carries the auth token.
  const path = link.url.replace(/^\/api\/v1/, '');
  return String(await downloadFile(path, link.fileName));
}
