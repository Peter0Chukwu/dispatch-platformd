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
  createApprovedRider,
  createStaff,
  registerAndActivateCustomer,
  resetUsers,
} from './helpers/auth-test-helpers';

const PICKUP = {
  address: '12 Adeola Odeku Street, Victoria Island, Lagos',
  lat: 6.4281,
  lng: 3.4219,
  contactName: 'Ada Okafor',
  contactPhone: '+2348031234567',
};
const DESTINATION = {
  address: '5 Bode Thomas Street, Surulere, Lagos',
  lat: 6.4969,
  lng: 3.3481,
  contactName: 'Chinedu Eze',
  contactPhone: '+2348069876543',
};

/**
 * Phase 11 — chat between the customer and the rider.
 *
 * The point of this suite is not that messages can be stored; it is that the
 * three promises hold: only the two parties can read the thread, only while the
 * delivery is live, and a phone number can never be smuggled through it.
 */
describe('Chat between the customer and the rider', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;
  let customer: Awaited<ReturnType<typeof registerAndActivateCustomer>>;
  let customerAuth: { Authorization: string };

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetUsers(prisma);
    await clearRateLimits(redis);
    customer = await registerAndActivateCustomer(app);
    customerAuth = { Authorization: `Bearer ${customer.accessToken}` };
  });

  /** Books a delivery and puts a rider on it, exactly as the desk would. */
  const deliveredJob = async () => {
    const booking = await request(app.getHttpServer())
      .post('/api/v1/deliveries')
      .set(customerAuth)
      .send({
        deliveryType: 'STANDARD',
        pickup: PICKUP,
        destination: DESTINATION,
        packageCategory: 'DOCUMENTS',
        packageDescription: 'Signed contracts in an A4 envelope',
        acceptTerms: true,
        paymentMethod: 'PAYSTACK',
      })
      .expect(201);

    const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
    const staff = await createStaff(prisma, passwords, ['OPERATIONS_MANAGER']);
    const staffLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/deliveries/${booking.body.id}/assign`)
      .set({ Authorization: `Bearer ${staffLogin.body.accessToken}` })
      .send({ riderId: rider.riderId, reason: 'Nearest rider for the chat test' })
      .expect(201);

    const riderLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: rider.email, password: VALID_PASSWORD, audience: 'RIDER' })
      .expect(201);

    return {
      deliveryId: booking.body.id as string,
      riderAuth: { Authorization: `Bearer ${riderLogin.body.accessToken}` },
    };
  };

  it('carries a message from the customer to the rider and back', async () => {
    const { deliveryId, riderAuth } = await deliveredJob();

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(customerAuth)
      .send({ body: 'Please call at the gate, the security will let you in.' })
      .expect(201);

    expect(sent.body.senderType).toBe('CUSTOMER');

    const riderView = await request(app.getHttpServer())
      .get(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(riderAuth)
      .expect(200);

    expect(riderView.body.messages).toHaveLength(1);
    expect(riderView.body.messages[0].body).toContain('security will let you in');

    await request(app.getHttpServer())
      .post(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(riderAuth)
      .send({ body: 'On my way, five minutes.' })
      .expect(201);

    const customerView = await request(app.getHttpServer())
      .get(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(customerAuth)
      .expect(200);

    expect(customerView.body.messages.map((m: { senderType: string }) => m.senderType)).toEqual([
      'CUSTOMER',
      'RIDER',
    ]);
  });

  it('refuses to let a different customer read or write the thread', async () => {
    const { deliveryId } = await deliveredJob();
    const stranger = await registerAndActivateCustomer(app);
    const strangerAuth = { Authorization: `Bearer ${stranger.accessToken}` };

    await request(app.getHttpServer())
      .get(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(strangerAuth)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(strangerAuth)
      .send({ body: 'Hello from someone who should not be here' })
      .expect(404);
  });

  it('refuses a phone number in the body, so numbers are never revealed', async () => {
    const { deliveryId } = await deliveredJob();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(customerAuth)
      .send({ body: 'Just ring me on 0803 123 4567 when you arrive' })
      .expect(422);

    expect(JSON.stringify(res.body)).toContain('Phone numbers cannot be shared');
  });

  it('closes the thread once the delivery has ended', async () => {
    const { deliveryId } = await deliveredJob();

    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Test' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(customerAuth)
      .send({ body: 'Are you still coming?' })
      .expect(409);

    // Reading the history stays allowed: the thread is evidence.
    const history = await request(app.getHttpServer())
      .get(`/api/v1/deliveries/${deliveryId}/messages`)
      .set(customerAuth)
      .expect(200);
    expect(history.body.messages).toEqual([]);
  });

  it('is closed to staff and to the public', async () => {
    const { deliveryId } = await deliveredJob();
    const staff = await createStaff(prisma, passwords, ['SUPPORT_AGENT']);
    const staffLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/deliveries/${deliveryId}/messages`)
      .set({ Authorization: `Bearer ${staffLogin.body.accessToken}` })
      .expect(403);

    await request(app.getHttpServer()).get(`/api/v1/deliveries/${deliveryId}/messages`).expect(401);
  });
});
