import { z } from 'zod';

const ngPhone = z
  .string()
  .trim()
  .refine((v) => /^(\+?234|0)[789][01]\d{8}$/.test(v.replace(/\s|-/g, '')), {
    message: 'Enter a valid Nigerian mobile number, e.g. 0803 123 4567',
  })
  .transform((v) => {
    const digits = v.replace(/[\s-]/g, '');
    const national = digits.replace(/^\+?234/, '').replace(/^0/, '');
    return `+234${national}`;
  });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter')
  .refine((v) => /\d/.test(v), 'Include at least one number');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const registerCustomerSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  email: emailSchema,
  phone: ngPhone,
  password: passwordSchema,
  acceptTerms: z.literal(true),
});
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or phone number'),
  password: z.string().min(1, 'Enter your password'),
  // Required, not defaulted: the portal choice must be explicit so a token is
  // never issued for the wrong audience by omission.
  audience: z.enum(['CUSTOMER', 'RIDER', 'ADMIN']),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const otpVerifySchema = z.object({
  phone: ngPhone,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3) });

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});
