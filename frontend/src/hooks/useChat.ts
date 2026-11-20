import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { LIVE_EVENTS, onLive } from '../lib/live';

export interface ChatMessage {
  id: string;
  deliveryId: string;
  senderType: 'CUSTOMER' | 'RIDER';
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface ContactStatus {
  connected: boolean;
  provider: string;
  /** True when the call happens inside the app, with no phone number anywhere. */
  inApp?: boolean;
  reason: string | null;
}

/** The thread for one delivery. Polling backstops the socket, so a missed event never strands a conversation. */
export function useMessages(deliveryId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['chat', deliveryId],
    queryFn: () => api.get<{ messages: ChatMessage[] }>(`/deliveries/${deliveryId}/messages`),
    enabled: Boolean(deliveryId) && (options?.enabled ?? true),
    refetchInterval: 15000,
  });
}

export function useSendMessage(deliveryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<ChatMessage>(`/deliveries/${deliveryId}/messages`, { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat', deliveryId] }),
  });
}

export function useContactStatus(deliveryId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['contact', deliveryId],
    queryFn: () => api.get<ContactStatus>(`/deliveries/${deliveryId}/contact`),
    enabled: Boolean(deliveryId) && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRequestCall(deliveryId: string) {
  return useMutation({
    mutationFn: () => api.post<{ proxyNumber: string; expiresAt: string }>(`/deliveries/${deliveryId}/contact/call`),
  });
}

/**
 * Which thread is on screen right now.
 *
 * Shared module state rather than context: the Contact card and the app-wide
 * message nudge are in different trees, and a message from the thread already
 * being read must not pop up as a notification about itself.
 */
let openThreadId: string | null = null;

export function setOpenThread(deliveryId: string | null): void {
  openThreadId = deliveryId;
}

export function isThreadOpen(deliveryId: string): boolean {
  return openThreadId === deliveryId;
}

export interface UnreadSummary {
  total: number;
  byDelivery: { deliveryId: string; count: number; lastAt: string | null }[];
}

/**
 * How many messages are waiting, per delivery.
 *
 * The badge is what makes the message box discoverable without adding a whole
 * inbox screen: the delivery the person already opens carries the mark. It is
 * refreshed when a message arrives over the live channel, and every 60 seconds as
 * a backstop for a socket that is reconnecting.
 */
export function useUnreadMessages(options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['chat', 'unread'],
    queryFn: () => api.get<UnreadSummary>('/chat/unread'),
    enabled: options?.enabled ?? true,
    refetchInterval: 60000,
    staleTime: 15000,
  });

  useEffect(() => {
    // A message for anybody invalidates the count; the refetch decides whose it is,
    // rather than the browser guessing from the payload.
    return onLive(LIVE_EVENTS.MESSAGE_NEW, () => {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
    });
  }, [queryClient]);

  const byDelivery = new Map((query.data?.byDelivery ?? []).map((row) => [row.deliveryId, row.count]));
  return { ...query, total: query.data?.total ?? 0, byDelivery };
}
