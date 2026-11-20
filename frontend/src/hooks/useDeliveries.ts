import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDeliveryInput, QuoteDeliveryInput } from '@dispatch/shared';
import { api } from '../lib/api';

export interface QuoteLine {
  label: string;
  amountKobo: string;
  kind: 'charge' | 'discount';
  note?: string;
}

export interface Quote {
  currency: string;
  deliveryType: string;
  zone: { id: string; code: string; name: string } | null;
  rule: { id: string; name: string; version: number };
  distanceKm: number;
  chargeableKm: number;
  freeKmIncluded: number;
  durationMinutes: number;
  routeSource: 'STUB' | 'GOOGLE' | 'GEOAPIFY' | 'MAPBOX';
  additionalStops: number;
  subtotalKobo: string;
  discountKobo: string;
  totalKobo: string;
  promo: { code: string; description: string; discountKobo: string } | null;
  lines: QuoteLine[];
  quotedAt: string;
}

export interface DeliveryTimelineEntry {
  status: string;
  at: string;
  reason: string | null;
}

export interface Delivery {
  /** Present on the customer's own view once a rider is assigned. Never a phone number. */
  riderFirstName?: string | null;
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  deliveryType: string;
  pickup: { address: string; landmark: string | null; lat: number; lng: number };
  destination: { address: string; landmark: string | null; lat: number; lng: number };
  distanceKm: number | null;
  durationMinutes: number | null;
  recipient: { name: string; phone: string };
  package: { category: string; description: string; weightKg: number | null; isFragile: boolean; specialInstructions: string | null };
  scheduledFor: string | null;
  /** The bill, the customer's asking price, and what was finally agreed. */
  pricing?: {
    quotedKobo: string;
    quotedFormatted: string;
    askKobo: string;
    askFormatted: string;
    isNegotiated: boolean;
    agreedKobo: string | null;
    agreedFormatted: string | null;
    agreedBasis: string | null;
  };
  chargeKobo: string;
  discountKobo: string;
  codAmountKobo: string;
  chargeFormatted: string;
  priceSnapshot: { lines?: QuoteLine[]; ruleName?: string; ruleVersion?: number; zoneName?: string | null; distanceKm?: number };
  createdAt: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  timeline?: DeliveryTimelineEntry[];
}

export interface DeliveryList {
  items: Delivery[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/** Price preview. Cached per coordinate pair so dragging back is instant and free. */
export function useQuote(input: QuoteDeliveryInput | null) {
  return useQuery({
    queryKey: ['quote', input],
    queryFn: () => api.post<Quote>('/deliveries/quote', input),
    enabled: input !== null,
    // A price is only valid for the current screen; never serve a stale one on mount.
    staleTime: 30_000,
    retry: false,
  });
}

export function useDeliveries(page = 1, status?: string) {
  return useQuery({
    queryKey: ['deliveries', page, status],
    queryFn: () => api.get<DeliveryList>(`/deliveries?page=${page}${status ? `&status=${status}` : ''}`),
  });
}

export function useDelivery(id: string | undefined) {
  return useQuery({
    queryKey: ['delivery', id],
    queryFn: () => api.get<Delivery>(`/deliveries/${id}`),
    enabled: !!id,
  });
}

export function useCreateDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeliveryInput) => api.post<Delivery>('/deliveries', input),
    onSuccess: () => {
      // The price and the booking changed; both caches are now wrong.
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['delivery'] });
    },
  });
}

export function useCancelDelivery(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.post<Delivery>(`/deliveries/${id}/cancel`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['delivery', id] });
    },
  });
}


/* ───────────────────────── the bill and the haggling ───────────────────────── */

export interface DeliveryOffer {
  assignmentId: string;
  riderName: string;
  riderCode: string;
  status: string;
  counterKobo: string | null;
  counterState: 'NONE' | 'PENDING' | 'DECLINED' | 'ACCEPTED';
  agreedKobo: string | null;
  offeredAt: string;
  expiresAt: string;
}

export interface DeliveryOffers {
  deliveryId: string;
  reference: string;
  status: string;
  quotedKobo: string;
  askKobo: string;
  isNegotiated: boolean;
  chargeKobo: string;
  agreedKobo: string | null;
  agreedBasis: string | null;
  ridersAsked: number;
  pendingCount: number;
  offers: DeliveryOffer[];
}

/** Who was asked, and who named a price. Polled while the job is on the board. */
export function useDeliveryOffers(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['delivery', id, 'offers'],
    queryFn: () => api.get<DeliveryOffers>(`/deliveries/${id}/offers`),
    enabled: !!id && enabled,
    refetchInterval: enabled ? 5000 : false,
    staleTime: 0,
  });
}

/** Accept a rider's price. That rider gets the job at that number. */
export function useAcceptOfferPrice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post<{ accepted: boolean; deliveryId: string; agreedKobo: string }>(
        `/deliveries/${id}/offers/${assignmentId}/accept`,
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['delivery', id] });
      void queryClient.invalidateQueries({ queryKey: ['delivery', id, 'offers'] });
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    },
  });
}

/** Turn a rider's price down. Their offer stays open at the price you asked. */
export function useDeclineOfferPrice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post<{ declined: boolean }>(`/deliveries/${id}/offers/${assignmentId}/decline`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['delivery', id, 'offers'] });
    },
  });
}
