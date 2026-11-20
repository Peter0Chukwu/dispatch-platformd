import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from './ui';
import { LIVE_EVENTS, onLive } from '../lib/live';
import { useAuth } from '../contexts/AuthContext';
import { isThreadOpen } from '../hooks/useChat';

/**
 * A small nudge when a message arrives on a thread that is not on screen.
 *
 * The chat itself stays where it is — inside the delivery — but a person should
 * not have to open every delivery to find out whether the rider said anything.
 * This listens on the live channel and raises a toast; the badge on the delivery
 * (and on the rider's current job) is what remains after the toast fades.
 *
 * Deliberately quiet: no sound, no browser notification, no badge on the tab.
 * Those are one step further than this needed to be, and each one asks permission
 * from the person, which is a decision for later.
 */
export function MessageNotifier() {
  const { user } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const myType = user?.type;

  useEffect(() => {
    if (!myType || (myType !== 'CUSTOMER' && myType !== 'RIDER')) return;

    return onLive(LIVE_EVENTS.MESSAGE_NEW, (payload) => {
      const message = payload as {
        deliveryId?: string;
        senderType?: 'CUSTOMER' | 'RIDER';
        body?: string;
      };
      if (!message.deliveryId || message.senderType === myType) return;

      // Refresh the waiting count either way; only the toast depends on what is open.
      void queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
      void queryClient.invalidateQueries({ queryKey: ['chat', message.deliveryId] });
      if (isThreadOpen(message.deliveryId)) return;

      const who = message.senderType === 'RIDER' ? 'Your rider' : 'Your customer';
      notify({
        tone: 'info',
        title: `New message from ${who.toLowerCase()}`,
        description: preview(message.body ?? ''),
      });
    });
  }, [myType, notify, queryClient]);

  return null;
}

/** Long messages are cut, so a toast never grows into a wall of text. */
function preview(body: string): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}
