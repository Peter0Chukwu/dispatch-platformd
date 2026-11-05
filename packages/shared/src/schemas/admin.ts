import { z } from "zod";
import { emailSchema, passwordSchema } from "./auth";
import { DeliveryStatus } from "../enums";

/* ─────────────────────── Phase 5 — admin command centre ──────────────────── */

const ngPhone = z
  .string()
  .trim()
  .refine(
    (value) => /^(\+?234|0)[789][01]\d{8}$/.test(value.replace(/[\s-]/g, "")),
    {
      message: "Enter a valid Nigerian mobile number, e.g. 0803 123 4567",
    },
  )
  .transform((value) => {
    const digits = value.replace(/[\s-]/g, "");
    return `+234${digits.replace(/^\+?234/, "").replace(/^0/, "")}`;
  });

export const dashboardQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const adminDeliveryQuerySchema = z.object({
  status: z
    .enum(Object.values(DeliveryStatus) as [string, ...string[]])
    .optional(),
  q: z.string().trim().max(120).optional(),
  riderId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminDeliveryQuery = z.infer<typeof adminDeliveryQuerySchema>;

export const assignDeliverySchema = z.object({
  riderId: z.string().uuid("Choose a rider"),
  reason: z.string().trim().max(300).optional(),
});
export type AssignDeliveryInput = z.infer<typeof assignDeliverySchema>;

export const staffReasonSchema = z.object({
  reason: z.string().trim().min(5, "Say why — it is recorded").max(300),
});
export type StaffReasonInput = z.infer<typeof staffReasonSchema>;

export const accountStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().max(300).optional(),
});
export type AccountStatusInput = z.infer<typeof accountStatusSchema>;

export const adminCustomerQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;

export const adminStaffQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminStaffQuery = z.infer<typeof adminStaffQuerySchema>;

export const createStaffSchema = z.object({
  firstName: z.string().trim().min(2, "Enter a first name").max(60),
  lastName: z.string().trim().min(2, "Enter a last name").max(60),
  email: emailSchema,
  phone: ngPhone,
  password: passwordSchema,
  roleKeys: z
    .array(z.string().trim().min(2))
    .min(1, "Give this person at least one role"),
  branchId: z.string().uuid().optional(),
  jobTitle: z.string().trim().max(80).optional(),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/**
 * Pricing edits arrive in naira — what an operator types — and the service
 * converts to integer kobo exactly once. Every field is optional: a PATCH-style
 * update must not require resending the whole rule.
 */
export const updatePricingRuleSchema = z
  .object({
    baseFeeNaira: z.number().min(0).max(10_000_000).optional(),
    perKmFeeNaira: z.number().min(0).max(1_000_000).optional(),
    minFeeNaira: z.number().min(0).max(10_000_000).optional(),
    freeKmIncluded: z.number().min(0).max(500).optional(),
    expressSurchargeNaira: z.number().min(0).max(1_000_000).optional(),
    scheduledSurchargeNaira: z.number().min(0).max(1_000_000).optional(),
    sameDaySurchargeNaira: z.number().min(0).max(1_000_000).optional(),
    additionalStopFeeNaira: z.number().min(0).max(1_000_000).optional(),
    defaultCommissionPct: z.number().min(0).max(100).optional(),
    roundToKobo: z
      .union([z.literal(1), z.literal(10), z.literal(50), z.literal(100)])
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });
export type UpdatePricingRuleInput = z.infer<typeof updatePricingRuleSchema>;
