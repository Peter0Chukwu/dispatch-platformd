import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompleteJobInput } from '@dispatch/shared';
import { api } from '../lib/api';

/* ─────────────────────────────── types ─────────────────────────────────── */

export type Availability = 'OFFLINE' | 'ONLINE' | 'ON_DELIVERY';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type DocumentType =
  | 'NIN'
  | 'DRIVERS_LICENCE'
  | 'VEHICLE_REGISTRATION'
  | 'PROOF_OF_ADDRESS'
  | 'GUARANTOR_FORM'
  | 'SELFIE';

export interface RiderDocument {
  id: string;
  type: DocumentType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  reviewNote: string | null;
  uploadedAt: string;
  expiresAt: string | null;
}

export interface EarningsSummary {
  deliveriesPaid: number;
  grossKobo: string;
  commissionKobo: string;
  pendingKobo: string;
  availableKobo: string;
  paidKobo: string;
  adjustmentsKobo: string;
  withdrawnKobo: string;
  withdrawableKobo: string;
  formatted: { available: string; pending: string; paid: string; withdrawable: string };
}

export interface RiderProfile {
  id: string;
  riderCode: string;
  approvalStatus: ApprovalStatus;
  availability: Availability;
  rating: { average: number; count: number };
  completedCount: number;
  cancelledCount: number;
  user: { firstName: string; lastName: string; phone: string | null; email: string; emailVerified: boolean; phoneVerified: boolean };
  branch: { name: string } | null;
  serviceZone: { name: string } | null;
  vehicle: { type: string; registrationNumber: string; isVerified: boolean } | null;
  documents: RiderDocument[];
  requiredDocuments: DocumentType[];
  missingDocuments: DocumentType[];
  canGoOnline: boolean;
  earnings: EarningsSummary;
}

export interface Offer {
  assignmentId: string;
  offeredAt: string;
  expiresAt: string;
  secondsLeft: number;
  offerTimeoutSeconds: number;
  distanceToPickupKm: number | null;
  delivery: {
    id: string;
    reference: string;
    deliveryType: string;
    zone: string | null;
    pickup: { address: string; landmark: string | null; lat: number; lng: number };
    destination: { address: string; landmark: string | null };
    distanceKm: number | null;
    durationMinutes: number | null;
    package: { category: string; description: string; isFragile: boolean };
    recipientName: string;
  };
  pay: {
    chargeKobo: string;
    commissionPct: number;
    commissionKobo: string;
    netKobo: string;
    netFormatted: string;
  };
}

export interface RiderJob {
  id: string;
  reference: string;
  status: string;
  statusLabel: string;
  deliveryType: string;
  pickup: { address: string; landmark: string | null; lat: number; lng: number };
  destination: { address: string; landmark: string | null; lat: number; lng: number };
  distanceKm: number | null;
  durationMinutes: number | null;
  recipientName: string;
  package: {
    category: string;
    description: string;
    weightKg: number | null;
    isFragile: boolean;
    specialInstructions: string | null;
  };
  pay: { chargeKobo: string; commissionPct: number; netKobo: string; netFormatted: string };
  createdAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  timeline?: Array<{ status: string; at: string; reason: string | null }>;
  earning: { netKobo: string; status: string } | null;
}

export interface JobHistory {
  items: RiderJob[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

type AvailabilityResponse = { availability: Availability };

/* ─────────────────────────────── hooks ─────────────────────────────────── */

export function useRiderProfile() {
  return useQuery({
    queryKey: ['rider', 'profile'],
    queryFn: () => api.get<RiderProfile>('/rider/profile'),
  });
}

/**
 * Sets ONLINE / OFFLINE. Going online has server-side preconditions (approval,
 * approved documents, active account) — the refusals are shown verbatim because
 * a rider needs to know *which* paper is missing.
 */
export function useSetAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (availability: 'ONLINE' | 'OFFLINE') =>
      api.post<AvailabilityResponse>('/rider/availability', { availability }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rider', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['rider', 'offers'] });
    },
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { docType: DocumentType; mimeType: string; base64: string; expiresAt?: string }) =>
      api.post<RiderDocument>('/rider/documents', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rider', 'profile'] });
    },
  });
}

export function useEarnings() {
  return useQuery({
    queryKey: ['rider', 'earnings'],
    queryFn: () => api.get<EarningsSummary>('/rider/earnings'),
  });
}

/**
 * Offers are polled while the rider is online. `secondsLeft` is recomputed by the
 * countdown from `expiresAt`, so a slow poll never displays a wrong timer.
 */
export function useOffers(enabled: boolean) {
  return useQuery({
    queryKey: ['rider', 'offers'],
    queryFn: () => api.get<Offer[]>('/rider/offers'),
    enabled,
    refetchInterval: enabled ? 4000 : false,
    // A poll that arrives late must not overwrite a fresher list with an older one.
    staleTime: 0,
  });
}

export function useAcceptOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => api.post<RiderJob>(`/rider/offers/${assignmentId}/accept`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rider', 'offers'] });
      void queryClient.invalidateQueries({ queryKey: ['rider', 'active-job'] });
      void queryClient.invalidateQueries({ queryKey: ['rider', 'profile'] });
    },
    // Losing a race is normal, not an error to retry silently.
    retry: false,
  });
}

export function useRejectOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, reason }: { assignmentId: string; reason?: string }) =>
      api.post<{ status: string }>(`/rider/offers/${assignmentId}/reject`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rider', 'offers'] });
    },
  });
}

export function useActiveJob() {
  return useQuery({
    queryKey: ['rider', 'active-job'],
    queryFn: () => api.get<RiderJob | null>('/rider/jobs/active'),
    refetchInterval: 20_000,
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ['rider', 'job', id],
    queryFn: () => api.get<RiderJob>(`/rider/jobs/${id}`),
    enabled: !!id,
  });
}

export function useJobHistory(page = 1) {
  return useQuery({
    queryKey: ['rider', 'jobs', page],
    queryFn: () => api.get<JobHistory>(`/rider/jobs?page=${page}`),
  });
}

export type JobStep = 'arrive-pickup' | 'pickup' | 'start-transit' | 'arrive-destination';

/** Advances the job one step. The server enforces the order; the UI only offers the legal next one. */
export function useAdvanceJob(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ step, position }: { step: JobStep; position?: { lat: number; lng: number } }) =>
      api.post<RiderJob>(`/rider/jobs/${id}/${step}`, position ?? {}),
    onSuccess: () => invalidateJob(queryClient, id),
  });
}

export function useCompleteJob(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CompleteJobInput) => api.post<RiderJob>(`/rider/jobs/${id}/complete`, input),
    onSuccess: () => invalidateJob(queryClient, id),
  });
}

export function useFailJob(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.post<RiderJob>(`/rider/jobs/${id}/fail`, { reason }),
    onSuccess: () => invalidateJob(queryClient, id),
  });
}

function invalidateJob(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  void queryClient.invalidateQueries({ queryKey: ['rider', 'job', id] });
  void queryClient.invalidateQueries({ queryKey: ['rider', 'active-job'] });
  void queryClient.invalidateQueries({ queryKey: ['rider', 'jobs'] });
  void queryClient.invalidateQueries({ queryKey: ['rider', 'profile'] });
  void queryClient.invalidateQueries({ queryKey: ['rider', 'earnings'] });
}
