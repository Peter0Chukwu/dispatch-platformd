import { DeliveryStatus } from './enums';

/**
 * THE delivery lifecycle, defined once and used in two places:
 *   1. the backend transition service (security boundary — decides if an update is allowed)
 *   2. the frontend rider/customer UIs (decides which action buttons to render)
 *
 * Having a single table means the UI can never offer an action the API will reject,
 * and the API can never be bypassed by a crafted request.
 */
export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  PENDING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'PENDING', 'CANCELLED'],
  ACCEPTED: ['ARRIVED_AT_PICKUP', 'CANCELLED', 'FAILED'],
  ARRIVED_AT_PICKUP: ['PICKED_UP', 'CANCELLED', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['ARRIVED_AT_DESTINATION', 'FAILED'],
  ARRIVED_AT_DESTINATION: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
  FAILED: ['RETURNED', 'DELIVERED', 'CANCELLED'],
  RETURNED: [],
};

export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: DeliveryStatus): readonly DeliveryStatus[] {
  return DELIVERY_TRANSITIONS[from];
}

export const TERMINAL_STATUSES: readonly DeliveryStatus[] = [
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'RETURNED',
];

export function isTerminal(status: DeliveryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Statuses where a delivery counts as "in progress" for rider capacity checks. */
export const ACTIVE_STATUSES: readonly DeliveryStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_AT_DESTINATION',
];
