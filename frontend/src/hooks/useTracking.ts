import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * TRACKING DATA (Phase 8)
 *
 * Two sources, on purpose:
 *
 *   · the socket pushes a ping the moment a rider reports one — fast, but only ever
 *     a hint that something changed;
 *   · the REST query is the truth, and it is what the map draws.
 *
 * So a socket event invalidates the query instead of writing into it. That means a
 * dropped packet cannot leave a marker somewhere the rider is not.
 */

export interface TrackedPosition {
  lat: number;
  lng: number;
  accuracyM: number | null;
  heading: number | null;
  speedKph: number | null;
  recordedAt: string;
  ageSeconds: number;
}

export interface Tracking {
  delivery: {
    id: string;
    reference: string;
    status: string;
    statusLabel: string;
    pickupAddress: string;
    destAddress: string;
    pickup: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    deliveredAt: string | null;
  };
  rider: { riderCode: string; name: string } | null;
  position: TrackedPosition | null;
  live: boolean;
  stale: boolean;
  eta: { minutes: number; distanceRemainingKm: number | null; source: string | null; headingTo: 'pickup' | 'destination' } | null;
  timeline: Array<{ status: string; label: string; at: string; reason: string | null }>;
  mapProvider: 'stub' | 'google' | 'mapbox';
  shareExpiresAt?: string | null;
}

export interface LiveMapRider {
  riderId: string;
  riderCode: string;
  name: string;
  phone: string;
  availability: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedKph: number | null;
  batteryPct: number | null;
  recordedAt: string;
  stale: boolean;
  activeDelivery: { id: string; reference: string; status: string } | null;
}

export interface LiveMapDelivery {
  id: string;
  reference: string;
  status: string;
  pickup: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  chargeFormatted: string;
  rider: { id: string; riderCode: string; name: string; position: { lat: number; lng: number; recordedAt: string } | null } | null;
  createdAt: string;
}

export interface LiveMap {
  generatedAt: string;
  freshnessWindowSeconds: number;
  summary: {
    onlineRiders: number;
    ridersOnDelivery: number;
    unassigned: number;
    activeDeliveries: number;
    positioned: number;
  };
  riders: LiveMapRider[];
  deliveries: LiveMapDelivery[];
  mapProvider: 'stub' | 'google' | 'mapbox';
}

export function useTracking(deliveryId: string | undefined) {
  return useQuery({
    queryKey: ['tracking', deliveryId],
    queryFn: () => api.get<Tracking>(`/deliveries/${deliveryId}/track`),
    enabled: Boolean(deliveryId),
    // The socket is the fast path; this poll is the safety net for a flaky mobile
    // connection, so it can be slow without anybody noticing.
    refetchInterval: 20_000,
  });
}

export function useShareLink(deliveryId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tracking', deliveryId] });

  const create = useMutation({
    mutationFn: () => api.post<{ token: string; url: string; expiresAt: string; ttlHours: number }>(`/deliveries/${deliveryId}/share-link`),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: () => api.post<{ revoked: boolean }>(`/deliveries/${deliveryId}/share-link/revoke`),
    onSuccess: invalidate,
  });

  return { create, revoke };
}

/** Public tracking — no token, no cookies, just the link the customer shared. */
export function usePublicTracking(token: string | undefined) {
  return useQuery({
    queryKey: ['public-tracking', token],
    queryFn: () => api.get<Tracking>(`/track/${token}`),
    enabled: Boolean(token),
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useLiveMap(enabled = true) {
  return useQuery({
    queryKey: ['admin-live-map'],
    queryFn: () => api.get<LiveMap>('/admin/tracking/live'),
    enabled,
    refetchInterval: 15_000,
  });
}
