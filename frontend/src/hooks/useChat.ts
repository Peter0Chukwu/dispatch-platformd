import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

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
