import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';

/** Safe, non-sensitive projection of a user. Passwords never appear here. */
export const USER_SAFE_SELECT = {
  id: true,
  type: true,
  status: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  avatarKey: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SAFE_SELECT });
  }

  /**
   * Finds a user by email OR Nigerian phone number.
   * Phone numbers are stored in E.164 (+234…) so "0803…" must be normalised first —
   * otherwise the same person could register twice with different formats.
   */
  async findByIdentifier(identifier: string) {
    const trimmed = identifier.trim();
    const normalisedPhone = normaliseToE164(trimmed);
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: trimmed.toLowerCase() }, ...(normalisedPhone ? [{ phone: normalisedPhone }] : [])],
        deletedAt: null,
      },
    });
  }

  async existsByEmail(email: string): Promise<boolean> {
    return (await this.prisma.user.count({ where: { email: email.toLowerCase() } })) > 0;
  }

  async existsByPhone(phone: string): Promise<boolean> {
    return (await this.prisma.user.count({ where: { phone } })) > 0;
  }

  toDto(user: {
    id: string;
    type: string;
    status: string;
    email: string | null;
    phone: string | null;
    firstName: string;
    lastName: string;
    avatarKey: string | null;
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
    mustChangePassword: boolean;
  }) {
    return {
      id: user.id,
      type: user.type,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      avatarUrl: user.avatarKey ? `/api/v1/files/${user.avatarKey}` : null,
      mustChangePassword: user.mustChangePassword,
    };
  }
}

export function normaliseToE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let national: string;
  if (digits.startsWith('+234')) national = digits.slice(4);
  else if (digits.startsWith('234')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;

  if (national.length !== 10) return null;
  const e164 = `+234${national}`;
  return /^\+234(70|71|80|81|90|91)\d{8}$/.test(e164) ? e164 : null;
}
