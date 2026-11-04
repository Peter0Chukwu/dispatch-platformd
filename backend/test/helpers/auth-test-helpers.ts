import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { RedisService } from '../../src/infra/redis/redis.service';
import { PasswordService } from '../../src/auth/password.service';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

/** A valid Nigerian mobile number, different on every call. */
export function uniquePhone(): string {
  const tail = String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');
  return `+23480${tail}`;
}

export const VALID_PASSWORD = 'Str0ngPassw0rd';

/** Wipes human-generated data between tests, keeping seeded reference data. */
export async function resetUsers(prisma: PrismaService): Promise<void> {
  // Explicit DELETEs, children first.
  //
  // Why not TRUNCATE ... CASCADE: `pricing_rules.createdById` references `staff`,
  // so cascading a truncate of staff silently deleted the SEEDED pricing
  // configuration. Deleting rows respects ON DELETE SET NULL and leaves the
  // reference data (zones, pricing, ledger accounts, roles) intact.
  const statements = [
    'audit_logs', 'verification_tokens', 'refresh_tokens',
    'wallet_transactions', 'wallets', 'notifications',
    'ticket_messages', 'support_tickets', 'complaints', 'reviews', 'promo_redemptions',
    'delivery_proofs', 'delivery_status_history', 'delivery_assignments', 'delivery_stops',
    'delivery_items', 'deliveries',
    'delivery_status_history', 'rider_locations', 'rider_documents', 'vehicles',
    'rider_earnings', 'rider_adjustments', 'withdrawals',
    'refunds', 'payments', 'payment_webhooks',
    'ledger_lines', 'journal_entries',
    'addresses',
    'customers', 'riders',
    'staff_roles', 'staff_branches', 'staff',
    'users',
  ];
  for (const table of statements) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
}

export async function clearRateLimits(redis: RedisService): Promise<void> {
  const keys = await redis.client.keys('ratelimit:*');
  if (keys.length > 0) await redis.client.del(...keys);
}

export async function createStaff(
  prisma: PrismaService,
  passwords: PasswordService,
  roleKeys: string[],
  overrides: { email?: string } = {},
) {
  const branch = await prisma.branch.findFirstOrThrow();
  const email = overrides.email ?? uniqueEmail('staff');
  const staffCount = await prisma.staff.count();

  const user = await prisma.user.create({
    data: {
      email,
      phone: uniquePhone(),
      passwordHash: await passwords.hash(VALID_PASSWORD),
      type: 'STAFF',
      status: 'ACTIVE',
      firstName: 'Test',
      lastName: 'Staff',
      emailVerifiedAt: new Date(),
      staff: {
        create: {
          staffCode: `STF-T${String(staffCount + 1).padStart(4, '0')}`,
          branchId: branch.id,
          isSuperAdmin: false,
          roles: { create: roleKeys.map((key) => ({ role: { connect: { key } } })) },
        },
      },
      wallet: { create: { type: 'COMPANY', balanceKobo: 0n } },
    },
    select: { id: true, email: true },
  });

  return { id: user.id, email: user.email!, password: VALID_PASSWORD };
}

export async function registerAndActivateCustomer(app: INestApplication) {
  const email = uniqueEmail('customer');
  const phone = uniquePhone();

  const register = await request(app.getHttpServer())
    .post('/api/v1/auth/register/customer')
    .send({ firstName: 'Ada', lastName: 'Okafor', email, phone, password: VALID_PASSWORD, acceptTerms: true })
    .expect(201);

  await request(app.getHttpServer())
    .post('/api/v1/auth/verify-email')
    .send({ token: register.body.verification.devToken })
    .expect(201);

  await request(app.getHttpServer())
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: register.body.verification.devCode })
    .expect(201);

  const login = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
    .expect(201);

  return {
    email,
    phone,
    userId: register.body.userId as string,
    accessToken: login.body.accessToken as string,
    cookies: login.headers['set-cookie'] as unknown as string[],
  };
}
