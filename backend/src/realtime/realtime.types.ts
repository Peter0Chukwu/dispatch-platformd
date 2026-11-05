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
  /** A delivery was created, moved, assigned or cancelled. */
  DELIVERY_NEW: 'delivery:new',
  DELIVERY_UPDATED: 'delivery:updated',
  /** Dispatch has run out of riders to ask. Staff must intervene. */
  DISPATCH_EXHAUSTED: 'dispatch:exhausted',
  /** The account was suspended mid-session: the socket is closed immediately. */
  SESSION_REVOKED: 'session:revoked',
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
