/**
 * REAL-TIME EVENT CONTRACT
 *
 * The names here are the whole protocol between the API and every open portal,
 * declared once so a typo cannot silently create an event nobody listens to.
 *
 * Rule of thumb: an event only ever tells a client that *something changed* and
 * carries the ids needed to react. The client then refetches from the REST API,
 * which is still the only source of truth — a socket message can never grant a
 * rider a delivery the database did not give them.
 */
export const RT = {
  /** Handshake accepted. Sent to the freshly connected socket only. */
  READY: 'ready',
  /** A new offer for this rider — the phone should buzz. */
  OFFER_NEW: 'offer:new',
  /** An offer was withdrawn because somebody else took the job or it expired. */
  OFFER_REVOKED: 'offer:revoked',
  /** A rider named their own price — the customer has an answer to give. */
  OFFER_COUNTERED: 'offer:countered',
  /** The customer accepted or turned down a rider's price. */
  COUNTER_ANSWERED: 'offer:counter-answered',
  /** A delivery was created, moved, assigned or cancelled. */
  DELIVERY_NEW: 'delivery:new',
  DELIVERY_UPDATED: 'delivery:updated',
  /** A chat message arrived on a delivery the socket is watching. */
  MESSAGE_NEW: 'message:new',
  /** A rider reported a position on an active delivery (Phase 8). */
  TRACKING_PING: 'tracking:update',
  /** Money moved: a payment settled, a wallet changed, a withdrawal advanced. */
  PAYMENT_UPDATED: 'payment:updated',
  /** Dispatch has run out of riders to ask. Staff must intervene. */
  DISPATCH_EXHAUSTED: 'dispatch:exhausted',
  /** The account was suspended mid-session: the socket is closed immediately. */
  SESSION_REVOKED: 'session:revoked',
  /* ── in-app calling (voice never leaves the two browsers) ── */
  /** Somebody is calling you about a live delivery. {@link CallPush} */
  CALL_INCOMING: 'call:incoming',
  /** The person you called picked up. */
  CALL_ACCEPTED: 'call:accepted',
  /** They declined, or the ring timed out. */
  CALL_DECLINED: 'call:declined',
  /** Either side hung up, or the call was closed for them. */
  CALL_ENDED: 'call:ended',
  /** WebRTC offer / answer / ICE candidate, relayed verbatim. */
  CALL_SIGNAL: 'call:signal',
  /** The call could not be placed at all. */
  CALL_ERROR: 'call:error',
  ERROR: 'error:api',
  PONG: 'pong',
} as const;

export type RealtimeEvent = (typeof RT)[keyof typeof RT];

export interface OfferPush {
  assignmentId: string;
  deliveryId: string;
  reference: string;
  pickupAddress: string;
  destAddress: string;
  distanceToPickupKm: number | null;
  chargeFormatted: string;
  netFormatted: string;
  expiresAt: string;
  secondsLeft: number;
}

export interface DeliveryPush {
  id: string;
  reference: string;
  status: string;
  deliveryType?: string;
  chargeFormatted?: string;
  riderCode?: string | null;
  customerName?: string;
  at: string;
}

export interface RevokedPush {
  assignmentId: string;
  deliveryId: string;
  reason: 'TAKEN' | 'CANCELLED' | 'REASSIGNED' | 'SUSPENDED';
}

/** Nothing here is a phone number: there is no number in an in-app call. */
export interface CallPush {
  callId: string;
  deliveryId: string;
  /** CUSTOMER or RIDER — who is calling. */
  from: 'CUSTOMER' | 'RIDER';
  /** First name only, so the callee knows who it is without any contact detail. */
  fromName: string;
}
