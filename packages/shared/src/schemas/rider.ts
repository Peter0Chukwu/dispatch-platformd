import { z } from 'zod';
import { VehicleType } from '../enums';
import { emailSchema, passwordSchema } from './auth';

const ngPhone = z
  .string()
  .trim()
  .refine((v) => /^(\+?234|0)[789][01]\d{8}$/.test(v.replace(/[\s-]/g, '')), {
    message: 'Enter a valid Nigerian mobile number, e.g. 0803 123 4567',
  })
  .transform((v) => {
    const digits = v.replace(/[\s-]/g, '');
    return `+234${digits.replace(/^\+?234/, '').replace(/^0/, '')}`;
  });

export const registerRiderSchema = z.object({
  firstName: z.string().trim().min(2, 'Enter your first name').max(60),
  lastName: z.string().trim().min(2, 'Enter your last name').max(60),
  email: emailSchema,
  phone: ngPhone,
  password: passwordSchema,
  addressLine: z.string().trim().min(8, 'Enter your residential address').max(300),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  vehicleType: z.enum([
    VehicleType.MOTORCYCLE,
    VehicleType.BICYCLE,
    VehicleType.TRICYCLE,
    VehicleType.CAR,
    VehicleType.VAN,
  ]),
  vehicleRegistrationNumber: z
    .string()
    .trim()
    .min(3, 'Enter your vehicle plate number')
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s+/g, ' ')),
  emergencyContactName: z.string().trim().min(2, 'Enter an emergency contact name').max(80),
  emergencyContactPhone: ngPhone,
  acceptTerms: z.literal(true, { message: 'You must accept the rider agreement' }),
});
export type RegisterRiderInput = z.infer<typeof registerRiderSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});

/* ───────────────────────── Phase 4 — rider operations ─────────────────────── */

export const riderAvailabilitySchema = z.object({
  availability: z.enum(['ONLINE', 'OFFLINE']),
});

export const locationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(5000).optional(),
  speedKph: z.number().nonnegative().max(200).optional(),
  heading: z.number().min(0).max(360).optional(),
  batteryPct: z.number().int().min(0).max(100).optional(),
  deliveryId: z.string().uuid().optional(),
});
export type LocationPingInput = z.infer<typeof locationPingSchema>;

/**
 * Documents arrive as base64 JSON rather than multipart: it keeps the upload path
 * dependency-free and identical under test. Size and MIME type are validated
 * server-side (5 MB, JPEG/PNG/WebP/PDF) — the browser's opinion is not trusted.
 */
export const uploadDocumentSchema = z.object({
  docType: z.enum(['NIN', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'PROOF_OF_ADDRESS', 'GUARANTOR_FORM', 'SELFIE']),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  base64: z.string().min(16, 'Attach a file'),
  expiresAt: z.coerce.date().optional(),
});

/**
 * Proof-of-delivery photo. Uploaded before calling complete; `complete` then
 * receives only the storage key, so the OTP and photo paths share one endpoint.
 */
export const proofPhotoSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(16, 'Attach a photo'),
});
export type ProofPhotoInput = z.infer<typeof proofPhotoSchema>;

export const rejectOfferSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const advanceJobSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const completeJobSchema = z
  .object({
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
    proofPhotoKey: z.string().max(300).optional(),
    recipientNameEntered: z.string().trim().min(2).max(80).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((value) => !!value.otp || (!!value.proofPhotoKey && !!value.recipientNameEntered), {
    message: 'Enter the recipient code, or attach a photo and the recipient’s name',
    path: ['otp'],
  });
export type CompleteJobInput = z.infer<typeof completeJobSchema>;

export const failJobSchema = z.object({
  reason: z.string().trim().min(5, 'Tell us what happened').max(300),
});

/* ────────────────────── Phase 4 — admin rider review ─────────────────────── */

export const ReviewDocumentSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(300, 'Keep the note under 300 characters').optional(),
  })
  .refine((value) => value.decision !== 'REJECT' || !!value.note?.trim(), {
    message: 'Say why the document was rejected — the rider sees this',
    path: ['note'],
  });
export type ReviewDocumentInput = z.infer<typeof ReviewDocumentSchema>;

export const SetRiderApprovalSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND']),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.decision === 'APPROVE' || !!value.reason?.trim(), {
    message: 'Give a reason — the rider sees it',
    path: ['reason'],
  });
export type SetRiderApprovalInput = z.infer<typeof SetRiderApprovalSchema>;
