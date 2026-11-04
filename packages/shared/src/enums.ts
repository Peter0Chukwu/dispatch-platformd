/**
 * Enumerations shared by the API and all three portals.
 * These MUST stay in sync with backend/prisma/schema.prisma — the
 * `enums.spec.ts` test in the backend fails if they drift apart.
 */

export const UserType = { CUSTOMER: 'CUSTOMER', RIDER: 'RIDER', STAFF: 'STAFF' } as const;
export type UserType = (typeof UserType)[keyof typeof UserType];

export const UserStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const RiderApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type RiderApprovalStatus = (typeof RiderApprovalStatus)[keyof typeof RiderApprovalStatus];

export const RiderAvailability = {
  OFFLINE: 'OFFLINE',
  ONLINE: 'ONLINE',
  ON_DELIVERY: 'ON_DELIVERY',
} as const;
export type RiderAvailability = (typeof RiderAvailability)[keyof typeof RiderAvailability];

export const VehicleType = {
  MOTORCYCLE: 'MOTORCYCLE',
  BICYCLE: 'BICYCLE',
  TRICYCLE: 'TRICYCLE',
  CAR: 'CAR',
  VAN: 'VAN',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

export const DeliveryType = {
  STANDARD: 'STANDARD',
  EXPRESS: 'EXPRESS',
  SCHEDULED: 'SCHEDULED',
  SAME_DAY: 'SAME_DAY',
} as const;
export type DeliveryType = (typeof DeliveryType)[keyof typeof DeliveryType];

export const DeliveryStatus = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  ARRIVED_AT_PICKUP: 'ARRIVED_AT_PICKUP',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED_AT_DESTINATION: 'ARRIVED_AT_DESTINATION',
  DELIVERED: 'DELIVERED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const DeliveryPaymentStatus = {
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const;
export type DeliveryPaymentStatus = (typeof DeliveryPaymentStatus)[keyof typeof DeliveryPaymentStatus];

export const AssignmentStatus = {
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const PaymentProvider = {
  PAYSTACK: 'PAYSTACK',
  FLUTTERWAVE: 'FLUTTERWAVE',
  WALLET: 'WALLET',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CASH: 'CASH',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export const WithdrawalStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;
export type WithdrawalStatus = (typeof WithdrawalStatus)[keyof typeof WithdrawalStatus];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  WHATSAPP: 'WHATSAPP',
  PUSH: 'PUSH',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** Human-readable labels for the UI. */
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: 'Awaiting rider',
  ASSIGNED: 'Rider assigned',
  ACCEPTED: 'Rider accepted',
  ARRIVED_AT_PICKUP: 'Rider at pickup',
  PICKED_UP: 'Package collected',
  IN_TRANSIT: 'In transit',
  ARRIVED_AT_DESTINATION: 'Rider at destination',
  DELIVERED: 'Delivered',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  RETURNED: 'Returned',
};

/** Tailwind colour tokens per status, used by <StatusPill />. */
export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'neutral',
  ASSIGNED: 'info',
  ACCEPTED: 'info',
  ARRIVED_AT_PICKUP: 'info',
  PICKED_UP: 'warning',
  IN_TRANSIT: 'warning',
  ARRIVED_AT_DESTINATION: 'warning',
  DELIVERED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'danger',
  FAILED: 'danger',
  RETURNED: 'neutral',
};
