import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service';
import type { RedisService } from '../src/infra/redis/redis.service';
import type { PasswordService } from '../src/auth/password.service';
import { createTestApp } from './helpers/app';
import {
  VALID_PASSWORD,
  clearRateLimits,
  createStaff,
  registerAndActivateCustomer,
  resetUsers,
  uniqueEmail,
  uniquePhone,
} from './helpers/auth-test-helpers';

/**
 * ADMIN ATTENTION — the work that only a human can do.
 *
 * The gap this suite locks down: the admin desk could not see the approval queue
 * or understand why the automatic search had stopped, so a rider signing up
 * looked like nothing had happened and a stalled job looked like a job nobody
 * wanted. Both are now stated plainly, and these tests keep them stated.
 *
 * It also pins the rule the desk relies on: a rider CANNOT be approved while a
 * required document is still unapproved. Approval is the admin's job; skipping
 * the identity check is not.
 */
describe('Admin attention: approvals and stalled dispatch', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;
  let staffAuth: { Authorization: string };
  let riderId: string;

  const loginStaff = async () => {
    const staff = await createStaff(prisma, passwords, ['OPERATIONS_MANAGER']);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  };

  /** A rider who has signed up and done nothing else — the state that was invisible. */
  const createPendingRider = async () => {
    const branch = await prisma.branch.findFirstOrThrow();
    const count = await prisma.rider.count();
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail('pending'),
        phone: uniquePhone(),
        passwordHash: await passwords.hash(VALID_PASSWORD),
        type: 'RIDER',
        status: 'ACTIVE',
        firstName: 'Sunday',
        lastName: 'Adeyemi',
        emailVerifiedAt: new Date(),
        rider: {
          create: {
            riderCode: `RDR-P${String(count + 1).padStart(4, '0')}`,
            branchId: branch.id,
            approvalStatus: 'PENDING',
            availability: 'OFFLINE',
            vehicles: {
              create: {
                type: 'MOTORCYCLE',
                registrationNumber: `LSP-${String(count + 1).padStart(3, '0')}AA`,
                isVerified: true,
              },
            },
          },
        },
        wallet: { create: { type: 'RIDER', balanceKobo: 0n } },
      },
      select: { rider: { select: { id: true } } },
    });
    return user.rider!.id;
  };

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetUsers(prisma);
    await clearRateLimits(redis);
    staffAuth = await loginStaff();
    riderId = await createPendingRider();
  });

  it('counts riders waiting for approval on the dashboard', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set(staffAuth)
      .expect(200);

    expect(res.body.riders.pendingApplications).toBeGreaterThanOrEqual(1);
    // Nothing is stalled in a fresh fixture, so the other two read zero rather
    // than being absent — a missing key would make the panel silently disappear.
    expect(res.body.deliveries.awaitingHuman).toBe(0);
    expect(res.body.riders.onlineWithoutPing).toBe(0);
  });

  it('puts a pending rider in the review queue', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/riders?status=PENDING')
      .set(staffAuth)
      .expect(200);

    const rows = res.body.data ?? res.body.items ?? res.body;
    const mine = rows.find((row: { id: string }) => row.id === riderId);
    expect(mine).toBeTruthy();
    expect(mine.approvalStatus).toBe('PENDING');
    // 0 of the required documents are approved, which is why the row is in the queue.
    expect(mine.documents.approved).toBe(0);
    expect(mine.documents.required).toBeGreaterThan(0);

    // The decision screen is the authority on whether Approve is allowed.
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/riders/${riderId}`)
      .set(staffAuth)
      .expect(200);
    expect(detail.body.canApprove).toBe(false);
    expect(detail.body.missingDocuments.length).toBeGreaterThan(0);
  });

  it('refuses approval while a required document is unapproved', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/riders/${riderId}/approval`)
      .set(staffAuth)
      .send({ decision: 'APPROVE' })
      .expect(409);

    expect(res.body.error.code).toBe('DOCUMENTS_INCOMPLETE');
    expect(res.body.error.message).toMatch(/Approve their documents first/);

    // And the rider is still not employable: dispatch must not offer them work.
    const rider = await prisma.rider.findUniqueOrThrow({
      where: { id: riderId },
      select: { approvalStatus: true },
    });
    expect(rider.approvalStatus).toBe('PENDING');
  });

  it('explains why a job the engine gave up on is waiting', async () => {
    const customer = await registerAndActivateCustomer(app);
    const created = await request(app.getHttpServer())
      .post('/api/v1/deliveries')
      .set({ Authorization: `Bearer ${customer.accessToken}` })
      .send({
        deliveryType: 'STANDARD',
        pickup: {
          address: '12 Adeola Odeku Street, Victoria Island, Lagos',
          lat: 6.4281,
          lng: 3.4219,
          contactName: 'Ada Okafor',
          contactPhone: '+2348031234567',
        },
        destination: {
          address: '5 Bode Thomas Street, Surulere, Lagos',
          lat: 6.4969,
          lng: 3.3481,
          contactName: 'Chinedu Eze',
          contactPhone: '+2348069876543',
        },
        packageCategory: 'DOCUMENTS',
        packageDescription: 'Signed contracts in an A4 envelope',
        acceptTerms: true,
        paymentMethod: 'PAYSTACK',
      })
      .expect(201);

    // Push it past the final round, which is the state the desk sees after a
    // failed search. Done directly because the point under test is the wording,
    // not the timer.
    const { dispatchMaxRounds } = { dispatchMaxRounds: 4 };
    await prisma.delivery.update({
      where: { id: created.body.id },
      data: { dispatchRound: dispatchMaxRounds },
    });

    const board = await request(app.getHttpServer())
      .get('/api/v1/admin/dispatch/board')
      .set(staffAuth)
      .expect(200);

    const row = (board.body.waiting ?? []).find(
      (entry: { id: string }) => entry.id === created.body.id,
    );
    expect(row).toBeTruthy();
    expect(row.dispatch.exhausted).toBe(true);
    // A sentence, not a bare flag: this is what the desk acts on.
    expect(typeof row.dispatch.blocking).toBe('string');
    expect(row.dispatch.blocking.length).toBeGreaterThan(20);
    expect(board.body.summary).toHaveProperty('onlineWithoutPing');
  });
});
