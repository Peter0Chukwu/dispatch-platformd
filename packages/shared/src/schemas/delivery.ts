import { z } from 'zod';
import { DeliveryType } from '../enums';
import { PACKAGE_CATEGORIES } from '../constants';
import { geoPointSchema, latitudeSchema, longitudeSchema } from './common';

const ngPhone = z
  .string()
  .trim()
  .refine((v) => /^(\+?234|0)[789][01]\d{8}$/.test(v.replace(/[\s-]/g, '')), {
    message: 'Enter a valid Nigerian mobile number',
  })
  .transform((v) => {
    const digits = v.replace(/[\s-]/g, '');
    return `+234${digits.replace(/^\+?234/, '').replace(/^0/, '')}`;
  });

export const addressInputSchema = z.object({
  address: z.string().trim().min(8, 'Enter the full street address').max(300),
  landmark: z.string().trim().max(160).optional(),
  lat: latitudeSchema,
  lng: longitudeSchema,
  contactName: z.string().trim().min(2).max(80),
  contactPhone: ngPhone,
});
export type AddressInput = z.infer<typeof addressInputSchema>;

/** POST /deliveries/quote — get a price WITHOUT creating a delivery. */
export const quoteDeliverySchema = z.object({
  deliveryType: z.enum([DeliveryType.STANDARD, DeliveryType.EXPRESS, DeliveryType.SCHEDULED, DeliveryType.SAME_DAY]),
  pickup: geoPointSchema,
  destination: geoPointSchema,
  additionalStops: z.number().int().min(0).max(3).default(0),
  scheduledFor: z.coerce.date().optional(),
  promoCode: z.string().trim().toUpperCase().max(30).optional(),
});
export type QuoteDeliveryInput = z.infer<typeof quoteDeliverySchema>;

const packageCategoryValues = PACKAGE_CATEGORIES.map((c) => c.value) as [string, ...string[]];

export const createDeliverySchema = z.object({
  deliveryType: z.enum([DeliveryType.STANDARD, DeliveryType.EXPRESS, DeliveryType.SCHEDULED, DeliveryType.SAME_DAY]),
  pickup: addressInputSchema,
  destination: addressInputSchema,
  packageCategory: z.enum(packageCategoryValues),
  packageDescription: z.string().trim().min(5, 'Describe the package').max(500),
  packageWeightKg: z.coerce.number().min(0).max(500).optional(),
  packagePhotoKey: z.string().max(300).optional(),
  isFragile: z.boolean().default(false),
  declaredValueKobo: z.coerce.bigint().nonnegative().optional(),
  specialInstructions: z.string().trim().max(500).optional(),
  scheduledFor: z.coerce.date().optional(),
  promoCode: z.string().trim().toUpperCase().max(30).optional(),
  codAmountKobo: z.coerce.bigint().nonnegative().default(0n),
  paymentMethod: z.enum(['PAYSTACK', 'FLUTTERWAVE', 'WALLET', 'CASH']).default('PAYSTACK'),
  acceptTerms: z.literal(true, { message: 'Accept the delivery terms to continue' }),
})
  .refine(
    (d) => d.deliveryType !== DeliveryType.SCHEDULED || !!d.scheduledFor,
    { message: 'Choose a date and time for a scheduled delivery', path: ['scheduledFor'] },
  )
  .refine(
    (d) => !d.scheduledFor || d.scheduledFor.getTime() > Date.now() + 15 * 60 * 1000,
    { message: 'Scheduled deliveries must be at least 15 minutes from now', path: ['scheduledFor'] },
  );
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;

/** POST /deliveries/package-photo — photograph the parcel before booking, get a key back. */
export const packagePhotoSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(16, 'Attach a photo of the parcel'),
});
export type PackagePhotoInput = z.infer<typeof packagePhotoSchema>;

/**
 * CHAT — the customer and the rider talking without either learning the other's
 * phone number. The guard below is the promise kept in code.
 */
export const MESSAGE_MAX_LENGTH = 1000;
const PHONE_LIKE = /(?:\+?234|0)[789][01]\d{8}/;

export const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Type a message')
    .max(MESSAGE_MAX_LENGTH, `Keep it under ${MESSAGE_MAX_LENGTH} characters`)
    .refine((value) => !PHONE_LIKE.test(value.replace(/[\s()-]/g, '')),
      { message: 'Phone numbers cannot be shared here. Use the Call button to reach each other.' }),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** Statuses in which the two parties may still talk to each other. */
export const CHAT_OPEN_STATUSES = [
  'ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION',
] as const;

export const cancelDeliverySchema = z.object({
  reason: z.string().trim().min(5, 'Give a short reason').max(300),
});

export const rateDeliverySchema = z.object({
  deliveryId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
  tags: z.array(z.string().max(40)).max(6).default([]),
});

export const completeDeliverySchema = z
  .object({
    otp: z.string().regex(/^\d{6}$/).optional(),
    recipientNameEntered: z.string().trim().min(2).max(80).optional(),
    proofPhotoKey: z.string().max(300).optional(),
  })
  .refine((v) => !!v.otp || (!!v.proofPhotoKey && !!v.recipientNameEntered), {
    message: 'Provide the recipient OTP, or a delivery photo plus the recipient name',
  });
