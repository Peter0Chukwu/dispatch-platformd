import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { roundKobo } from '@dispatch/shared';
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
} from './helpers/auth-test-helpers';

/** Two real Lagos points ~8 km apart, used for every price assertion. */
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

const packageInput = {
  packageCategory: 'DOCUMENTS',
  packageDescription: 'A4 envelope with signed contracts',
};

function booking(overrides: Record<string, unknown> = {}) {
  return {
    deliveryType: 'STANDARD',
    pickup: PICKUP,
    destination: DESTINATION,
    ...packageInput,
    acceptTerms: true,
    paymentMethod: 'PAYSTACK',
    ...overrides,
  };
}

describe('Phase 3 — pricing engine and delivery booking', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;
  let customer: Awaited<ReturnType<typeof registerAndActivateCustomer>>;

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetUsers(prisma);
    await clearRateLimits(redis);
    // Promotions are reference data the reset deliberately keeps; clear any left by a test.
    await prisma.promotion.deleteMany({});
    customer = await registerAndActivateCustomer(app);
  });

  const auth = (token = customer.accessToken) => ({ Authorization: `Bearer ${token}` });

  // ─────────────────────────────── QUOTES ────────────────────────────────────

  describe('POST /deliveries/quote', () => {
    it('prices a trip from the active rule in the database', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({ deliveryType: 'STANDARD', pickup: { lat: PICKUP.lat, lng: PICKUP.lng }, destination: { lat: DESTINATION.lat, lng: DESTINATION.lng } })
        .expect(201);

      const quote = res.body;
      const rule = await prisma.pricingRule.findFirstOrThrow({ where: { isActive: true } });

      // The price must be explainable from the rule row, not from a constant in code.
      expect(quote.rule.id).toBe(rule.id);
      expect(quote.currency).toBe('NGN');
      expect(quote.distanceKm).toBeGreaterThan(0);
      expect(quote.zone?.code).toBeTruthy();

      const chargeableKm = Math.max(0, quote.distanceKm - rule.freeKmIncluded);
      expect(quote.chargeableKm).toBeCloseTo(chargeableKm, 1);
      expect(quote.freeKmIncluded).toBe(rule.freeKmIncluded);

      const base = BigInt(quote.lines[0].amountKobo);
      const distance = BigInt(quote.lines[1].amountKobo);
      expect(base).toBe(rule.baseFeeKobo);
      expect(distance).toBe(BigInt(Math.round(chargeableKm * Number(rule.perKmFeeKobo))));

      // Total = subtotal - discount, and nothing else.
      expect(BigInt(quote.totalKobo)).toBe(BigInt(quote.subtotalKobo) - BigInt(quote.discountKobo));
      expect(quote.discountKobo).toBe('0');
    });

    it('measures the distance server-side and reports it came from the stub', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({ deliveryType: 'STANDARD', pickup: { lat: PICKUP.lat, lng: PICKUP.lng }, destination: { lat: DESTINATION.lat, lng: DESTINATION.lng } })
        .expect(201);

      // Victoria Island → Surulere is ~11 km in a straight line; with the 1.35 road
      // factor that is ~15 km. Wide bounds so a real Directions API still passes.
      const { distanceKm, routeSource } = res.body;
      if (routeSource === 'STUB') {
        expect(distanceKm).toBeGreaterThan(9);
        expect(distanceKm).toBeLessThan(20);
      }
      expect(['STUB', 'GOOGLE']).toContain(routeSource);
    });

    it('charges more for express than standard on the same trip', async () => {
      const [standard, express] = await Promise.all(
        ['STANDARD', 'EXPRESS'].map((deliveryType) =>
          request(app.getHttpServer())
            .post('/api/v1/deliveries/quote')
            .set(auth())
            .send({ deliveryType, pickup: { lat: PICKUP.lat, lng: PICKUP.lng }, destination: { lat: DESTINATION.lat, lng: DESTINATION.lng } })
            .expect(201),
        ),
      );
      expect(BigInt(express!.body.totalKobo)).toBeGreaterThan(BigInt(standard!.body.totalKobo));
    });

    it('never charges less than the minimum fee for a very short trip', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({ deliveryType: 'STANDARD', pickup: { lat: 6.45, lng: 3.39 }, destination: { lat: 6.4505, lng: 3.3905 } })
        .expect(201);

      const rule = await prisma.pricingRule.findFirstOrThrow({ where: { isActive: true } });
      expect(BigInt(res.body.totalKobo)).toBeGreaterThanOrEqual(rule.minFeeKobo);
    });

    it('rejects a pickup outside the service area with a field-level message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({ deliveryType: 'STANDARD', pickup: { lat: 9.0765, lng: 7.3986 } /* Abuja */, destination: { lat: 9.08, lng: 7.4 } })
        .expect(422);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details[0].field).toBe('pickup');
    });

    it('refuses a rider or staff token (portal separation)', async () => {
      const branch = await prisma.branch.findFirstOrThrow();
      const rider = await prisma.user.create({
        data: {
          email: uniqueEmail('rider'),
          phone: '+2348090000001',
          passwordHash: await passwords.hash(VALID_PASSWORD),
          type: 'RIDER',
          status: 'ACTIVE',
          firstName: 'Rita',
          lastName: 'Rider',
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: new Date(),
          rider: {
            create: {
              riderCode: 'RDR-T0001',
              branch: { connect: { id: branch.id } },
              approvalStatus: 'APPROVED',
              vehicles: { create: { type: 'MOTORCYCLE', registrationNumber: 'LSD-001AA' } },
            },
          },
          wallet: { create: { type: 'RIDER', balanceKobo: 0n } },
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: rider.email, password: VALID_PASSWORD, audience: 'RIDER' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .send({ deliveryType: 'STANDARD', pickup: { lat: PICKUP.lat, lng: PICKUP.lng }, destination: { lat: DESTINATION.lat, lng: DESTINATION.lng } })
        .expect(403);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).post('/api/v1/deliveries/quote').send({}).expect(401);
    });
  });

  // ─────────────────────────────── BOOKINGS ──────────────────────────────────

  describe('POST /deliveries', () => {
    it('charges exactly the quoted total and freezes the breakdown', async () => {
      const quote = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({ deliveryType: 'STANDARD', pickup: { lat: PICKUP.lat, lng: PICKUP.lng }, destination: { lat: DESTINATION.lat, lng: DESTINATION.lng } })
        .expect(201);

      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      // Quote and charge must agree to the kobo, even though they are two requests.
      expect(created.body.chargeKobo).toBe(quote.body.totalKobo);
      expect(created.body.status).toBe('PENDING');
      expect(created.body.reference).toMatch(/^DSP-\d{6}-[A-Z2-9]{4}$/);

      const snapshot = created.body.priceSnapshot;
      expect(snapshot.totalKobo).toBe(quote.body.totalKobo);
      expect(snapshot.ruleVersion).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(snapshot.lines)).toBe(true);
      expect(snapshot.lines.at(-1).label).toBe('Total');

      // The database row, not just the response, holds the frozen price.
      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.chargeKobo).toBe(BigInt(quote.body.totalKobo));
    });

    it('ignores a price sent by the client', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send({ ...booking(), chargeKobo: 1, totalKobo: 1, discountKobo: 999999 })
        .expect(201);

      expect(BigInt(created.body.chargeKobo)).toBeGreaterThan(1000n * 100n);
    });

    it('rejects a package description that is too short', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking({ packageDescription: 'box' }))
        .expect(422);
      expect(res.body.error.details[0].field).toBe('packageDescription');
    });

    it('rejects a booking without accepting the terms', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send({ ...booking(), acceptTerms: false })
        .expect(422);
      expect(res.body.error.details.some((d: { field?: string }) => d.field === 'acceptTerms')).toBe(true);
    });

    it('writes the first entry of the status timeline', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      expect(created.body.timeline).toHaveLength(1);
      expect(created.body.timeline[0].status).toBe('PENDING');

      const history = await prisma.deliveryStatusHistory.findMany({
        where: { deliveryId: created.body.id },
      });
      expect(history).toHaveLength(1);
      expect(history[0]!.actorType).toBe('CUSTOMER');
    });

    it('never exposes the completion OTP hash', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      expect(JSON.stringify(created.body)).not.toContain('otpHash');
    });
  });

  // ─────────────────────────────── OWNERSHIP ─────────────────────────────────

  describe('ownership and portal isolation', () => {
    it('hides another customer\'s delivery behind a 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      const other = await registerAndActivateCustomer(app);

      await request(app.getHttpServer())
        .get(`/api/v1/deliveries/${created.body.id}`)
        .set(auth(other.accessToken))
        .expect(404);
    });

    it('lists only the caller\'s own deliveries', async () => {
      await request(app.getHttpServer()).post('/api/v1/deliveries').set(auth()).send(booking()).expect(201);
      const other = await registerAndActivateCustomer(app);
      await request(app.getHttpServer()).post('/api/v1/deliveries').set(auth(other.accessToken)).send(booking()).expect(201);

      const mine = await request(app.getHttpServer())
        .get('/api/v1/deliveries')
        .set(auth())
        .expect(200);

      expect(mine.body.total).toBe(1);
      expect(mine.body.items).toHaveLength(1);
    });

    it('blocks staff from the customer booking routes', async () => {
      const staff = await createStaff(prisma, passwords, ['SUPPORT_AGENT']);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: staff.email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(201);

      await request(app.getHttpServer())
        .get('/api/v1/deliveries')
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .expect(403);
    });

    it('lets staff read any delivery through the staff route', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      const staff = await createStaff(prisma, passwords, ['OPERATIONS_MANAGER']);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: staff.email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/staff/deliveries/${created.body.id}`)
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .expect(200);

      expect(res.body.reference).toBe(created.body.reference);
      expect(res.body.customerName).toContain('Ada');
    });

    it('blocks a customer from the staff delivery routes', async () => {
      await request(app.getHttpServer()).get('/api/v1/staff/deliveries').set(auth()).expect(403);
    });
  });

  // ─────────────────────────────── CANCELLATION ──────────────────────────────

  describe('cancelling', () => {
    it('cancels a pending delivery and records who did it and why', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${created.body.id}/cancel`)
        .set(auth())
        .send({ reason: 'I booked the wrong address' })
        .expect(201);

      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.cancellationReason).toBe('I booked the wrong address');
      expect(cancelled.body.timeline.map((t: { status: string }) => t.status)).toEqual(['PENDING', 'CANCELLED']);

      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row.cancelledById).toBe(customer.userId);
    });

    it('refuses a second cancellation', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${created.body.id}/cancel`)
        .set(auth())
        .send({ reason: 'Changed my mind' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${created.body.id}/cancel`)
        .set(auth())
        .send({ reason: 'Trying again' })
        .expect(409);
      expect(res.body.error.code).toBe('DELIVERY_NOT_CANCELLABLE');
    });

    it('refuses to cancel once the rider is carrying the package', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      // The state machine, not the UI, is what blocks this.
      await prisma.delivery.update({
        where: { id: created.body.id },
        data: { status: 'PICKED_UP', pickedUpAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${created.body.id}/cancel`)
        .set(auth())
        .send({ reason: 'Too late' })
        .expect(409);
      expect(res.body.error.message).toContain('already on the way');
    });

    it('requires a reason', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking())
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${created.body.id}/cancel`)
        .set(auth())
        .send({ reason: 'x' })
        .expect(422);
    });
  });

  // ─────────────────────────────── PROMOTIONS ────────────────────────────────

  describe('promotions', () => {
    const createPromo = async (overrides: Record<string, unknown> = {}) =>
      prisma.promotion.create({
        data: {
          code: 'LAGOS10',
          type: 'PERCENT',
          value: 10,
          maxDiscountKobo: 50_000n,
          minOrderKobo: null,
          usageLimit: 100,
          perCustomerLimit: 1,
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 86_400_000),
          isActive: true,
          ...overrides,
        },
      });

    it('applies a percentage discount capped at its maximum', async () => {
      await createPromo();

      const quote = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({
          deliveryType: 'STANDARD',
          pickup: { lat: PICKUP.lat, lng: PICKUP.lng },
          destination: { lat: DESTINATION.lat, lng: DESTINATION.lng },
          promoCode: 'lagos10',
        })
        .expect(201);

      const subtotal = BigInt(quote.body.subtotalKobo);
      const discount = BigInt(quote.body.discountKobo);
      const tenPercent = (subtotal * 10n) / 100n;
      // The engine rounds every discount to 50 kobo so the arithmetic is exact and
      // reproducible; the test mirrors the documented rule rather than assuming it.
      const capped = tenPercent > 50_000n ? 50_000n : tenPercent;
      const expected = roundKobo(capped, 50);

      expect(quote.body.promo.code).toBe('LAGOS10');
      expect(discount).toBe(expected);
      expect(BigInt(quote.body.totalKobo)).toBe(subtotal - discount);
    });

    it('records the redemption and refuses the same customer a second time', async () => {
      await createPromo();

      const first = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking({ promoCode: 'LAGOS10' }))
        .expect(201);
      expect(BigInt(first.body.discountKobo)).toBeGreaterThan(0n);

      const redemption = await prisma.promoRedemption.findFirstOrThrow({
        where: { deliveryId: first.body.id },
      });
      expect(redemption.discountKobo).toBe(BigInt(first.body.discountKobo));

      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries')
        .set(auth())
        .send(booking({ promoCode: 'LAGOS10' }))
        .expect(422);
      expect(res.body.error.details[0].field).toBe('promoCode');
    });

    it('rejects an expired promo', async () => {
      await createPromo({
        code: 'OLD5',
        startsAt: new Date(Date.now() - 172_800_000),
        endsAt: new Date(Date.now() - 86_400_000),
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({
          deliveryType: 'STANDARD',
          pickup: { lat: PICKUP.lat, lng: PICKUP.lng },
          destination: { lat: DESTINATION.lat, lng: DESTINATION.lng },
          promoCode: 'OLD5',
        })
        .expect(422);
      expect(res.body.error.details[0].message).toContain('expired');
    });

    it('rejects an unknown promo code without hinting that it might exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({
          deliveryType: 'STANDARD',
          pickup: { lat: PICKUP.lat, lng: PICKUP.lng },
          destination: { lat: DESTINATION.lat, lng: DESTINATION.lng },
          promoCode: 'NOPE123',
        })
        .expect(422);
      expect(res.body.error.details[0].message).toBe('That promo code is not valid');
    });

    it('can make a delivery free but never negative', async () => {
      await createPromo({ code: 'FREEBIE', type: 'FREE_DELIVERY', value: 0 });

      const res = await request(app.getHttpServer())
        .post('/api/v1/deliveries/quote')
        .set(auth())
        .send({
          deliveryType: 'STANDARD',
          pickup: { lat: PICKUP.lat, lng: PICKUP.lng },
          destination: { lat: DESTINATION.lat, lng: DESTINATION.lng },
          promoCode: 'FREEBIE',
        })
        .expect(201);

      expect(res.body.totalKobo).toBe('0');
      expect(BigInt(res.body.discountKobo)).toBe(BigInt(res.body.subtotalKobo));
    });
  });
});
