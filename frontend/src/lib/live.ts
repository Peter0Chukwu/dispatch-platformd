import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshAccessToken } from './api';

/**
 * LIVE CHANNEL (client side)
 *
 * One socket per tab, opened once the session exists and closed on sign-out.
 * Events are deliberately thin: they say *something changed*, and the screen then
 * refetches through the REST API. A socket message can never invent state — if the
 * server did not persist it, the refetch will not show it.
 *
 * The token is supplied through Socket.IO's `auth` callback, which runs on every
 * (re)connection, so a reconnect after a token rotation still authenticates. If
 * the access token has been lost (the tab slept for an hour), the callback rotates
 * the refresh cookie itself rather than connecting as nobody.
 */
export const LIVE_EVENTS = {
  READY: 'ready',
  OFFER_NEW: 'offer:new',
  OFFER_REVOKED: 'offer:revoked',
  DELIVERY_NEW: 'delivery:new',
  DELIVERY_UPDATED: 'delivery:updated',
  /** A chat message arrived on a delivery this client is party to. */
  MESSAGE_NEW: 'message:new',
  /** A rider reported a position on an active delivery (Phase 8). */
  TRACKING_PING: 'tracking:update',
  DISPATCH_EXHAUSTED: 'dispatch:exhausted',
  SESSION_REVOKED: 'session:revoked',
  /* ── in-app calling ── */
  CALL_INCOMING: 'call:incoming',
  CALL_ACCEPTED: 'call:accepted',
  CALL_DECLINED: 'call:declined',
  CALL_ENDED: 'call:ended',
  CALL_SIGNAL: 'call:signal',
  CALL_ERROR: 'call:error',
  ERROR: 'error:api',
} as const;

type Handler = (payload: unknown) => void;

let socket: Socket | null = null;
let connected = false;
const handlers = new Map<string, Set<Handler>>();
const statusListeners = new Set<(connected: boolean) => void>();

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const listener of statusListeners) listener(next);
}

/** Opens the live channel. Safe to call repeatedly. */
export function connectLive(): void {
  if (socket) return;

  socket = io('/live', {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    auth: (cb: (data: { token: string | null }) => void) => {
      const token = getAccessToken();
      if (token) return cb({ token });
      void refreshAccessToken().then((renewed) => cb({ token: renewed }));
    },
  });

  socket.on('connect', () => setConnected(true));
  socket.on('disconnect', () => {
    setConnected(false);
    // Anything that only works over a live connection (a call, most obviously)
    // must stop claiming to work the moment the connection goes.
    window.dispatchEvent(new CustomEvent('live:dropped'));
  });
  socket.on('connect_error', () => setConnected(false));

  socket.on(LIVE_EVENTS.SESSION_REVOKED, () => {
    // The session ended server-side (suspended, signed out elsewhere). Tell the app
    // so it can clear the screen instead of showing stale data until a click fails.
    window.dispatchEvent(new CustomEvent('live:session-revoked'));
    disconnectLive();
  });

  for (const [event, subscribers] of handlers) {
    socket.on(event, (payload: unknown) => {
      for (const subscriber of subscribers) subscriber(payload);
    });
  }
}

export function disconnectLive(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  setConnected(false);
}

/**
 * Subscribe to one event. Subscriptions registered before the socket exists are
 * replayed onto it by `connectLive`, so a component can mount before sign-in.
 */
export function onLive(event: string, handler: Handler): () => void {
  const set = handlers.get(event) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(event, set);
  socket?.on(event, handler);

  return () => {
    set.delete(handler);
    socket?.off(event, handler);
  };
}

/**
 * Ask the server to put this socket in a delivery's tracking room.
 *
 * The server decides: the owning customer, the assigned rider and staff with
 * `delivery:read` are admitted; anybody else is told FORBIDDEN and never receives
 * a position. Joining is best-effort — the polling query keeps the map working if
 * the socket is down.
 */
export function subscribeToDelivery(deliveryId: string): () => void {
  if (!socket) return () => {};
  socket.emit('subscribe:delivery', { deliveryId });
  return () => {};
}

/**
 * Send an event up the live channel.
 *
 * Returns false when there is no socket — calling code should tell the user the
 * channel is down rather than wait for a reply that cannot arrive.
 */
export function emitLive(event: string, payload: unknown, ack?: (reply: unknown) => void): boolean {
  if (!socket) return false;
  if (ack) socket.emit(event, payload, ack);
  else socket.emit(event, payload);
  return true;
}

/** React binding: run `handler` whenever the event arrives. */
export function useLiveEvent(event: string, handler: Handler): void {
  useEffect(() => onLive(event, handler), [event, handler]);
}

/** React binding: is the channel up right now? */
export function useLiveStatus(): boolean {
  const [isConnected, setIsConnected] = useState(connected);
  useEffect(() => {
    statusListeners.add(setIsConnected);
    setIsConnected(connected);
    return () => {
      statusListeners.delete(setIsConnected);
    };
  }, []);
  return isConnected;
}
