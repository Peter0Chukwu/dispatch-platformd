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
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the rider agreement' }) }),
});
export type RegisterRiderInput = z.infer<typeof registerRiderSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});
