import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service';
import type { RedisService } from '../src/infra/redis/redis.service';
import type { PasswordService } from '../src/auth/password.service';
import { MapsService } from '../src/pricing/maps.service';
import { TrackingService } from '../src/tracking/tracking.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { createTestApp } from './helpers/app';
import {
  clearRateLimits,
  createApprovedRider,
  createStaff,
  registerAndActivateCustomer,
  resetUsers,
} from './helpers/auth-test-helpers';

/**
 * PHASE 8 — MAPS, TRACKING AND REALTIME
 *
 * The thesis of this suite: a position on this platform is *evidence*, not
 * decoration. Every test below either proves that a real coordinate survived the
 * round trip, or proves that somebody who should not see it could not.
 *
 * Covered here:
 *   · address autocomplete and reverse geocoding answering honestly, with the
 *     provider named in the response (no invented addresses);
 *   · a rider ping that lands in the database, scoped to the job they actually hold;
 *   · a customer tracking their own delivery and getting an ETA from the rider's
 *     real position;
 *   · another customer getting 404 for the same delivery;
 *   · a share link that works with no account, leaks no phone number, expires and
 *     can be revoked;
 *   · tracking switching itself off at DELIVERED;
 *   · the admin live map requiring `tracking:read`;
 *   · a socket being refused a delivery room it does not own.
 */
describe('Phase 8 — maps, tracking and realtime', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;
  let maps: MapsService;
  let tracking: TrackingService;
  let gateway: RealtimeGateway;

  const PICKUP = { address: '12 Adeola Odeku Street, Victoria Island', lat: 6.4281, lng: 3.4219 };
  const DEST = { address: '5 Bode Thomas Street, Surulere', lat: 6.4969, lng: 3.3481 };

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
    maps = app.get(MapsService);
    tracking = app.get(TrackingService);
    gateway = app.get(RealtimeGateway);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetUsers(prisma);
    await clearRateLimits(redis);
  });

  /* ───────────────────────────── helpers ───────────────────────────── */

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  const book = async (token: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/deliveries')
      .set(as(token))
      .send({
        deliveryType: 'STANDARD',
        pickup: { ...PICKUP, contactName: 'Ada Okafor', contactPhone: '+2348039876543' },
        destination: { ...DEST, contactName: 'Chinedu Eze', contactPhone: '+2348069876543' },
        packageCategory: 'DOCUMENTS',
        packageDescription: 'Signed contracts',
        packageWeightKg: 0.5,
        recipientName: 'Chinedu Eze',
        recipientPhone: '+2348069876543',
        acceptTerms: true,
        paymentMethod: 'PAYSTACK',
      })
      .expect(201);
    return { id: res.body.id as string, reference: res.body.reference as string };
  };

  /** Put a rider on a job without running the whole offer dance. */
  const assignRider = async (deliveryId: string, status: 'ACCEPTED' | 'PICKED_UP' = 'ACCEPTED') => {
    const rider = await createApprovedRider(prisma, passwords, app);
    await prisma.rider.update({ where: { id: rider.riderId }, data: { availability: 'ON_DELIVERY' } });
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { riderId: rider.riderId, status, acceptedAt: new Date(), ...(status === 'PICKED_UP' ? { pickedUpAt: new Date() } : {}) },
    });
    return rider;
  };

  const loginStaff = async (roleKeys: string[]) => {
    const staff = await createStaff(prisma, passwords, roleKeys);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);
    return { ...staff, accessToken: login.body.accessToken as string };
  };

  /* ───────────────────────────── 1. addresses ───────────────────────────── */

  describe('address lookup', () => {
    it('suggests real Lagos places and says which provider answered', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/maps/places?q=lekki').expect(200);

      expect(res.body.provider).toBe(maps.provider);
      expect(res.body.data.length).toBeGreaterThan(0);
      const lekki = res.body.data[0];
      expect(lekki.address).toContain('Lekki');
      // Every suggestion carries real coordinates — the booking form never invents a pin.
      expect(typeof lekki.lat).toBe('number');
      expect(typeof lekki.lng).toBe('number');
      expect(['STUB', 'GOOGLE', 'MAPBOX']).toContain(lekki.source);
    });

    it('returns nothing for a one-letter query instead of guessing', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/maps/places?q=a').expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('reverse geocodes a coordinate to a readable place', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/maps/reverse?lat=6.4410&lng=3.4740')
        .expect(200);
      expect(res.body.data.address).toBeTruthy();
      expect(res.body.data.lat).toBeCloseTo(6.441, 3);
      // Stub answers are marked approximate; the UI shows that to the user.
      if (res.body.data.source === 'STUB') expect(res.body.data.approximate).toBe(true);
    });

    it('geocodes a written address server-side', async () => {
      const result = await maps.geocode('Yaba Commercial Avenue');
      expect(result).not.toBeNull();
      expect(result!.lat).toBeCloseTo(6.5095, 3);
    });
  });

  /* ───────────────────────────── 2. rider pings ───────────────────────────── */

  describe('rider location pings', () => {
    it('stores the ping and attaches it to the job the rider actually holds', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await assignRider(delivery.id);

      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(as(rider.accessToken))
        .send({ lat: 6.4312, lng: 3.4231, accuracyM: 12, speedKph: 24, heading: 90 })
        .expect(201);

      expect(res.body.recorded).toBe(true);
      expect(res.body.deliveryId).toBe(delivery.id);

      const stored = await prisma.riderLocation.findFirstOrThrow({
        where: { riderId: rider.riderId },
        orderBy: { recordedAt: 'desc' },
      });
      expect(stored.deliveryId).toBe(delivery.id);
      expect(stored.lat).toBeCloseTo(6.4312, 4);
      expect(stored.speedKph).toBe(24);
    });

    it("ignores a deliveryId that belongs to somebody else's job", async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await createApprovedRider(prisma, passwords, app);

      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(as(rider.accessToken))
        .send({ lat: 6.5, lng: 3.4, deliveryId: delivery.id })
        .expect(201);

      // The ping is still recorded (we always want the rider's position), but it is
      // NOT attached to a job they do not hold — so no customer is shown this rider.
      expect(res.body.deliveryId).toBeNull();
      const stored = await prisma.riderLocation.findFirstOrThrow({ where: { riderId: rider.riderId } });
      expect(stored.deliveryId).toBeNull();
    });

    it('publishes the configured cadence to the rider app', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      const res = await request(app.getHttpServer())
        .get('/api/v1/rider/location/config')
        .set(as(rider.accessToken))
        .expect(200);
      expect(res.body.pingIntervalSeconds).toBeGreaterThan(0);
      expect(res.body.staleAfterSeconds).toBe(600);
    });
  });

  /* ───────────────────────────── 3. customer tracking ───────────────────────────── */

  describe('customer tracking', () => {
    it('reports the rider\'s real position and an ETA to the delivery point', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await assignRider(delivery.id);

      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(as(rider.accessToken))
        .send({ lat: 6.4420, lng: 3.4300 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/deliveries/${delivery.id}/track`)
        .set(as(customer.accessToken))
        .expect(200);

      expect(res.body.position.lat).toBeCloseTo(6.442, 3);
      expect(res.body.position.lng).toBeCloseTo(3.43, 3);
      expect(res.body.live).toBe(true);
      expect(res.body.stale).toBe(false);
      // ACCEPTED means the rider is still on their way to collect the parcel.
      expect(res.body.eta.headingTo).toBe('pickup');
      expect(res.body.eta.minutes).toBeGreaterThan(0);
      expect(res.body.rider.riderCode).toMatch(/^RDR-/);
      expect(res.body.delivery.statusLabel).toBeTruthy();
      expect(res.body.timeline.length).toBeGreaterThan(0);
    });

    it('answers 404 when a different customer asks for the same tracking', async () => {
      const owner = await registerAndActivateCustomer(app);
      const delivery = await book(owner.accessToken);
      await assignRider(delivery.id);

      const stranger = await registerAndActivateCustomer(app);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/deliveries/${delivery.id}/track`)
        .set(as(stranger.accessToken))
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('says "no position" rather than inventing one before the first ping', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      await assignRider(delivery.id);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/deliveries/${delivery.id}/track`)
        .set(as(customer.accessToken))
        .expect(200);

      expect(res.body.position).toBeNull();
      expect(res.body.eta).toBeNull();
      expect(res.body.live).toBe(true);
    });

    it('stops tracking once the parcel is delivered', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await assignRider(delivery.id, 'PICKED_UP');
      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(as(rider.accessToken))
        .send({ lat: 6.49, lng: 3.35 })
        .expect(201);

      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/deliveries/${delivery.id}/track`)
        .set(as(customer.accessToken))
        .expect(200);

      expect(res.body.delivery.status).toBe('DELIVERED');
      expect(res.body.live).toBe(false);
      expect(res.body.position).toBeNull();
      expect(res.body.eta).toBeNull();
    });
  });

  /* ───────────────────────────── 4. share links ───────────────────────────── */

  describe('public share links', () => {
    it('creates a link that works with no account and hides personal details', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await assignRider(delivery.id);
      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(as(rider.accessToken))
        .send({ lat: 6.45, lng: 3.44 })
        .expect(201);

      const link = await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${delivery.id}/share-link`)
        .set(as(customer.accessToken))
        .expect(201);

      expect(link.body.token).toBeTruthy();
      expect(link.body.url).toContain('/track/');
      expect(new Date(link.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const publicView = await request(app.getHttpServer()).get(`/api/v1/track/${link.body.token}`).expect(200);

      expect(publicView.body.delivery.reference).toBe(delivery.reference);
      expect(publicView.body.position.lat).toBeCloseTo(6.45, 2);
      // A share link reveals the parcel, not the people: first name only, no phone,
      // no address contacts, no customer identity.
      expect(publicView.body.rider.name).not.toContain(' ');
      const raw = JSON.stringify(publicView.body);
      expect(raw).not.toContain(rider.phone);
      expect(raw).not.toContain(customer.email);
      expect(raw).not.toContain('+234');
    });

    it('stops working the moment it is revoked', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const link = await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${delivery.id}/share-link`)
        .set(as(customer.accessToken))
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${delivery.id}/share-link/revoke`)
        .set(as(customer.accessToken))
        .expect(201);

      await request(app.getHttpServer()).get(`/api/v1/track/${link.body.token}`).expect(404);
    });

    it('refuses an expired link', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const link = await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${delivery.id}/share-link`)
        .set(as(customer.accessToken))
        .expect(201);

      // Reach into the record and age the expiry, exactly as an hour of waiting would.
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { shareTokenExpiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app.getHttpServer()).get(`/api/v1/track/${link.body.token}`).expect(409);
      expect(res.body.error.message).toMatch(/expired/i);
    });

    it('will not mint a link for a delivery the caller does not own', async () => {
      const owner = await registerAndActivateCustomer(app);
      const delivery = await book(owner.accessToken);
      const stranger = await registerAndActivateCustomer(app);

      await request(app.getHttpServer())
        .post(`/api/v1/deliveries/${delivery.id}/share-link`)
        .set(as(stranger.accessToken))
        .expect(404);
    });
  });

  /* ───────────────────────────── 5. admin live map ───────────────────────────── */

  describe('the dispatcher map', () => {
    it('shows positioned riders and live jobs to staff who may see them', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await assignRider(delivery.id);
      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(as(rider.accessToken))
        .send({ lat: 6.4700, lng: 3.4100 })
        .expect(201);

      const admin = await loginStaff(['SUPER_ADMIN']);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/tracking/live')
        .set(as(admin.accessToken))
        .expect(200);

      expect(res.body.mapProvider).toBe(maps.provider);
      expect(res.body.freshnessWindowSeconds).toBeGreaterThan(0);

      const marker = res.body.riders.find((row: { riderId: string }) => row.riderId === rider.riderId);
      expect(marker).toBeTruthy();
      expect(marker.lat).toBeCloseTo(6.47, 2);
      expect(marker.stale).toBe(false);
      expect(marker.activeDelivery.id).toBe(delivery.id);

      const job = res.body.deliveries.find((row: { id: string }) => row.id === delivery.id);
      expect(job.status).toBe('ACCEPTED');
      expect(job.pickup.lat).toBeCloseTo(PICKUP.lat, 2);
      expect(job.rider.position.lat).toBeCloseTo(6.47, 2);
    });

    it('marks a rider whose last ping is old as stale instead of moving them', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const rider = await assignRider(delivery.id);
      await prisma.riderLocation.create({
        data: {
          riderId: rider.riderId,
          deliveryId: delivery.id,
          lat: 6.47,
          lng: 3.41,
          recordedAt: new Date(Date.now() - 30 * 60 * 1000),
        },
      });

      const admin = await loginStaff(['SUPER_ADMIN']);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/tracking/live')
        .set(as(admin.accessToken))
        .expect(200);

      const marker = res.body.riders.find((row: { riderId: string }) => row.riderId === rider.riderId);
      expect(marker.stale).toBe(true);
    });

    it('denies a support agent with no tracking permission', async () => {
      const support = await loginStaff(['SUPPORT_AGENT']);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/tracking/live')
        .set(as(support.accessToken))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies a customer outright — the admin surface is staff only', async () => {
      const customer = await registerAndActivateCustomer(app);
      await request(app.getHttpServer())
        .get('/api/v1/admin/tracking/live')
        .set(as(customer.accessToken))
        .expect(403);
    });
  });

  /* ───────────────────────────── 6. socket rooms ───────────────────────────── */

  describe('socket delivery rooms', () => {
    const fakeClient = (principal: Record<string, unknown>) => {
      const joined: string[] = [];
      return {
        joined,
        client: {
          data: { principal },
          join: async (name: string) => {
            joined.push(name);
          },
        } as never,
      };
    };

    it('lets the owning customer subscribe to their delivery room', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const customerRow = await prisma.customer.findFirstOrThrow({
        where: { user: { email: customer.email } },
        select: { id: true, userId: true },
      });

      const { client, joined } = fakeClient({ type: 'CUSTOMER', userId: customerRow.userId, customerId: customerRow.id });
      const result = await gateway.subscribeToDelivery(client, { deliveryId: delivery.id });

      expect(result.ok).toBe(true);
      expect(joined).toEqual([`delivery:${delivery.id}`]);
    });

    it('answers FORBIDDEN to a customer who does not own the delivery', async () => {
      const owner = await registerAndActivateCustomer(app);
      const delivery = await book(owner.accessToken);
      const stranger = await registerAndActivateCustomer(app);
      const strangerRow = await prisma.customer.findFirstOrThrow({
        where: { user: { email: stranger.email } },
        select: { id: true, userId: true },
      });

      const { client, joined } = fakeClient({ type: 'CUSTOMER', userId: strangerRow.userId, customerId: strangerRow.id });
      const result = await gateway.subscribeToDelivery(client, { deliveryId: delivery.id });

      expect(result).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(joined).toEqual([]);
    });

    it('answers UNAUTHORIZED when the socket has no principal at all', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const { client } = fakeClient(undefined as never);
      const result = await gateway.subscribeToDelivery({ data: {} } as never, { deliveryId: delivery.id });
      expect(result.ok).toBe(false);
      void client;
    });
  });

  /* ───────────────────────────── 7. retention ───────────────────────────── */

  describe('position retention', () => {
    it('prunes only pings older than the retention window', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      const old = await prisma.riderLocation.create({
        data: { riderId: rider.riderId, lat: 6.5, lng: 3.4, recordedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
      });
      const fresh = await prisma.riderLocation.create({
        data: { riderId: rider.riderId, lat: 6.51, lng: 3.41 },
      });

      const { LocationRetentionScheduler } = await import('../src/tracking/location-retention.scheduler');
      const scheduler = app.get(LocationRetentionScheduler);
      await scheduler.sweep();

      expect(await prisma.riderLocation.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await prisma.riderLocation.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    });
  });
});
