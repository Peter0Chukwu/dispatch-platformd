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

/** A 1x1 PNG — the smallest valid image, used to prove upload handling. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Phase 4 — rider portal, offers and the delivery workflow', () => {
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
    customer = await registerAndActivateCustomer(app);
  });

  const asRider = (token: string) => ({ Authorization: `Bearer ${token}` });

  const bookDelivery = async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/deliveries')
      .set({ Authorization: `Bearer ${customer.accessToken}` })
      .send({
        deliveryType: 'STANDARD',
        pickup: PICKUP,
        destination: DESTINATION,
        packageCategory: 'DOCUMENTS',
        packageDescription: 'A4 envelope with signed contracts',
        acceptTerms: true,
        paymentMethod: 'PAYSTACK',
      })
      .expect(201);
    return res.body as { id: string; reference: string; chargeKobo: string };
  };

  const goOnline = async (token: string) => {
    await request(app.getHttpServer())
      .post('/api/v1/rider/availability')
      .set(asRider(token))
      .send({ availability: 'ONLINE' })
      .expect(201);
  };

  // ────────────────────────────── GOING ON DUTY ──────────────────────────────

  describe('going online', () => {
    it('refuses a rider whose account is not approved yet', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await prisma.rider.update({ where: { id: rider.riderId }, data: { approvalStatus: 'PENDING' } });

      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(asRider(rider.accessToken))
        .send({ availability: 'ONLINE' })
        .expect(403);
      expect(res.body.error.message).toContain('still being reviewed');

      const row = await prisma.rider.findUniqueOrThrow({ where: { id: rider.riderId } });
      expect(row.availability).toBe('OFFLINE');
    });

    it('refuses a rider whose documents are not approved, and names them', async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });

      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(asRider(rider.accessToken))
        .send({ availability: 'ONLINE' })
        .expect(409);
      expect(res.body.error.code).toBe('DOCUMENTS_INCOMPLETE');
      expect(res.body.error.message).toContain('nin');
    });

    it('lets an approved, documented rider go online and offline', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);

      const online = await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(asRider(rider.accessToken))
        .send({ availability: 'ONLINE' })
        .expect(201);
      expect(online.body.availability).toBe('ONLINE');

      const offline = await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(asRider(rider.accessToken))
        .send({ availability: 'OFFLINE' })
        .expect(201);
      expect(offline.body.availability).toBe('OFFLINE');
    });

    it('reports honest document state on the profile', async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
      const res = await request(app.getHttpServer())
        .get('/api/v1/rider/profile')
        .set(asRider(rider.accessToken))
        .expect(200);

      expect(res.body.canGoOnline).toBe(false);
      expect(res.body.missingDocuments).toHaveLength(3);
    });
  });

  // ─────────────────────────────── DOCUMENTS ────────────────────────────────

  describe('document upload', () => {
    it('accepts an image and marks it PENDING review', async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });

      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/documents')
        .set(asRider(rider.accessToken))
        .send({ docType: 'NIN', mimeType: 'image/png', base64: TINY_PNG })
        .expect(201);

      expect(res.body.status).toBe('PENDING');

      const row = await prisma.riderDocument.findFirstOrThrow({ where: { riderId: rider.riderId } });
      expect(row.fileKey).toMatch(/^riders\/.+\/documents\/.+\.png$/);
      expect(row.sizeBytes).toBeGreaterThan(0);
    });

    it('rejects an unsupported file type', async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/documents')
        .set(asRider(rider.accessToken))
        .send({ docType: 'NIN', mimeType: 'application/zip', base64: TINY_PNG })
        .expect(422);
      expect(res.body.error.details[0].field).toBe('mimeType');
    });

    it('rejects an empty file', async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
      await request(app.getHttpServer())
        .post('/api/v1/rider/documents')
        .set(asRider(rider.accessToken))
        .send({ docType: 'NIN', mimeType: 'image/png', base64: '' })
        .expect(422);
    });

    it('keeps one current document per type', async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
      await request(app.getHttpServer())
        .post('/api/v1/rider/documents')
        .set(asRider(rider.accessToken))
        .send({ docType: 'NIN', mimeType: 'image/png', base64: TINY_PNG })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/rider/documents')
        .set(asRider(rider.accessToken))
        .send({ docType: 'NIN', mimeType: 'image/jpeg', base64: TINY_PNG })
        .expect(201);

      const rows = await prisma.riderDocument.findMany({ where: { riderId: rider.riderId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.mimeType).toBe('image/jpeg');
    });
  });

  // ──────────────────────────────── OFFERS ──────────────────────────────────

  describe('offers', () => {
    it('offers a new booking to an online, approved rider', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);

      const delivery = await bookDelivery();

      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);

      expect(offers.body).toHaveLength(1);
      expect(offers.body[0].delivery.reference).toBe(delivery.reference);
      const window = offers.body[0].offerTimeoutSeconds as number;
      expect(window).toBeGreaterThan(0);
      expect(offers.body[0].secondsLeft).toBeGreaterThan(0);
      expect(offers.body[0].secondsLeft).toBeLessThanOrEqual(window);

      // The rider sees what they would earn, not just the customer's price.
      expect(BigInt(offers.body[0].pay.netKobo)).toBeLessThan(BigInt(delivery.chargeKobo));
      expect(BigInt(offers.body[0].pay.netKobo)).toBeGreaterThan(0n);
    });

    it('offers a waiting delivery to a rider the moment they come online', async () => {
      // Nobody is online yet, so the booking has no rider to offer to.
      const delivery = await bookDelivery();
      const before = await prisma.deliveryAssignment.count({ where: { deliveryId: delivery.id } });
      expect(before).toBe(0);

      const rider = await createApprovedRider(prisma, passwords, app);
      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(asRider(rider.accessToken))
        .send({ lat: 6.4301, lng: 3.4197 })
        .expect(201);

      const online = await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(asRider(rider.accessToken))
        .send({ availability: 'ONLINE' })
        .expect(201);
      // The response reports what the capacity sweep actually did.
      expect(online.body.waitingOffers).toBeGreaterThanOrEqual(1);

      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);
      expect(offers.body.map((offer: { delivery: { id: string } }) => offer.delivery.id)).toContain(delivery.id);
    });

    it('does not nag a rider who already passed on the job', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();

      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);
      const assignmentId = offers.body[0].assignmentId as string;

      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/reject`)
        .set(asRider(rider.accessToken))
        .send({ reason: 'Too far from my route' })
        .expect(201);

      // Going offline and online again must not re-offer a job they refused.
      await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(asRider(rider.accessToken))
        .send({ availability: 'OFFLINE' })
        .expect(201);
      await goOnline(rider.accessToken);

      const after = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);
      expect(after.body).toHaveLength(0);

      // But another rider still gets it, so the delivery is not stranded.
      const other = await createApprovedRider(prisma, passwords, app);
      await goOnline(other.accessToken);
      const otherOffers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(other.accessToken))
        .expect(200);
      expect(otherOffers.body.map((offer: { delivery: { id: string } }) => offer.delivery.id)).toContain(delivery.id);
    });

    it('does not offer work to a rider who is offline', async () => {
      const rider = await createApprovedRider(prisma, passwords, app); // OFFLINE by default
      await bookDelivery();

      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);
      expect(offers.body).toHaveLength(0);
    });

    it('assigns the delivery when the rider accepts and freezes the commission', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();

      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);
      const assignmentId = offers.body[0].assignmentId as string;

      const accepted = await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);
      expect(accepted.body.deliveryId).toBe(delivery.id);

      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe('ACCEPTED');
      expect(row.riderId).toBe(rider.riderId);
      expect(row.commissionSnapshot).toBeTruthy();

      const busyRider = await prisma.rider.findUniqueOrThrow({ where: { id: rider.riderId } });
      expect(busyRider.availability).toBe('ON_DELIVERY');
    });

    /**
     * The race that matters: three phones buzz, two riders tap "Accept" at the
     * same instant. Exactly one may win, and the loser must get a clear refusal.
     */
    it('lets exactly one of two racing riders win the same delivery', async () => {
      const first = await createApprovedRider(prisma, passwords, app);
      const second = await createApprovedRider(prisma, passwords, app);
      await goOnline(first.accessToken);
      await goOnline(second.accessToken);

      const delivery = await bookDelivery();

      const offersA = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(first.accessToken))
        .expect(200);
      const offersB = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(second.accessToken))
        .expect(200);

      expect(offersA.body).toHaveLength(1);
      expect(offersB.body).toHaveLength(1);

      const [resultA, resultB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/rider/offers/${offersA.body[0].assignmentId}/accept`)
          .set(asRider(first.accessToken)),
        request(app.getHttpServer())
          .post(`/api/v1/rider/offers/${offersB.body[0].assignmentId}/accept`)
          .set(asRider(second.accessToken)),
      ]);

      const statuses = [resultA.status, resultB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const winners = [resultA, resultB].filter((r) => r.status === 201);
      expect(winners).toHaveLength(1);

      // The database agrees: one rider, one accepted assignment.
      const rows = await prisma.deliveryAssignment.findMany({
        where: { deliveryId: delivery.id, status: 'ACCEPTED' },
      });
      expect(rows).toHaveLength(1);
      const deliveryRow = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(deliveryRow.riderId).toBe(rows[0]!.riderId);
    });

    it('refuses a second accept of the same offer by the same rider', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      await bookDelivery();
      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);
      const id = offers.body[0].assignmentId as string;

      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${id}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${id}/accept`)
        .set(asRider(rider.accessToken))
        .expect(409);
      expect(second.body.error.code).toBe('OFFER_EXPIRED');
    });

    it('refuses an offer that has already expired', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();

      await prisma.deliveryAssignment.updateMany({
        where: { deliveryId: delivery.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(rider.accessToken))
        .expect(200);
      expect(offers.body).toHaveLength(0);

      const assignment = await prisma.deliveryAssignment.findFirstOrThrow({ where: { deliveryId: delivery.id } });
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignment.id}/accept`)
        .set(asRider(rider.accessToken))
        .expect(409);
    });

    it('passes a rejected job to the next rider', async () => {
      const first = await createApprovedRider(prisma, passwords, app);
      const second = await createApprovedRider(prisma, passwords, app);
      await goOnline(first.accessToken);
      await goOnline(second.accessToken);

      await bookDelivery();

      const offersA = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(first.accessToken))
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${offersA.body[0].assignmentId}/reject`)
        .set(asRider(first.accessToken))
        .send({ reason: 'Too far from me' })
        .expect(201);

      const again = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(first.accessToken))
        .expect(200);
      expect(again.body).toHaveLength(0);

      const rejected = await prisma.deliveryAssignment.findUniqueOrThrow({
        where: { id: offersA.body[0].assignmentId },
      });
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Too far from me');
    });

    it('blocks a customer token from every rider route', async () => {
      const auth = { Authorization: `Bearer ${customer.accessToken}` };
      await request(app.getHttpServer()).get('/api/v1/rider/offers').set(auth).expect(403);
      await request(app.getHttpServer()).get('/api/v1/rider/jobs/active').set(auth).expect(403);
      await request(app.getHttpServer()).get('/api/v1/rider/profile').set(auth).expect(403);
      await request(app.getHttpServer()).get('/api/v1/rider/earnings').set(auth).expect(403);
    });
  });

  // ───────────────────────────── THE JOB WORKFLOW ────────────────────────────

  describe('the delivery workflow', () => {
    const acceptJob = async (token: string) => {
      const offers = await request(app.getHttpServer())
        .get('/api/v1/rider/offers')
        .set(asRider(token))
        .expect(200);
      return offers.body[0].assignmentId as string;
    };

    it('walks a delivery from acceptance to payment', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();
      const assignmentId = await acceptJob(rider.accessToken);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);

      const steps: Array<[string, string]> = [
        ['arrive-pickup', 'ARRIVED_AT_PICKUP'],
        ['pickup', 'PICKED_UP'],
        ['start-transit', 'IN_TRANSIT'],
        ['arrive-destination', 'ARRIVED_AT_DESTINATION'],
      ];
      for (const [path, expected] of steps) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/rider/jobs/${delivery.id}/${path}`)
          .set(asRider(rider.accessToken))
          .send({ lat: 6.45, lng: 3.4 })
          .expect(201);
        expect(res.body.status).toBe(expected);
      }

      // The customer sees the same progress.
      const asCustomer = await request(app.getHttpServer())
        .get(`/api/v1/deliveries/${delivery.id}`)
        .set({ Authorization: `Bearer ${customer.accessToken}` })
        .expect(200);
      expect(asCustomer.body.status).toBe('ARRIVED_AT_DESTINATION');

      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/fail`)
        .set(asRider(rider.accessToken))
        .send({ reason: 'Recipient refused the package' })
        .expect(201);

      const failed = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(failed.status).toBe('FAILED');
    });

    /** Books, accepts and walks a job as far as IN_TRANSIT. */
    const jobInTransit = async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();
      const assignmentId = await acceptJob(rider.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);
      for (const path of ['arrive-pickup', 'pickup', 'start-transit']) {
        await request(app.getHttpServer())
          .post(`/api/v1/rider/jobs/${delivery.id}/${path}`)
          .set(asRider(rider.accessToken))
          .send({})
          .expect(201);
      }
      return { rider, delivery };
    };

    it('stores a proof-of-delivery photo and completes the job with it', async () => {
      const { rider, delivery } = await jobInTransit();

      const upload = await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/proof-photo`)
        .set(asRider(rider.accessToken))
        .send({ mimeType: 'image/png', base64: TINY_PNG })
        .expect(201);

      expect(upload.body.proofPhotoKey).toMatch(new RegExp(`^proofs/${delivery.id}/`));
      expect(upload.body.sizeBytes).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/arrive-destination`)
        .set(asRider(rider.accessToken))
        .send({})
        .expect(201);

      const completed = await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(asRider(rider.accessToken))
        .send({ proofPhotoKey: upload.body.proofPhotoKey, recipientNameEntered: 'Chinedu Eze' })
        .expect(201);

      expect(completed.body.status).toBe('DELIVERED');

      const proof = await prisma.deliveryProof.findFirst({ where: { deliveryId: delivery.id } });
      expect(proof?.type).toBe('PHOTO');
      expect(proof?.fileKey).toBe(upload.body.proofPhotoKey);
      expect(proof?.recipientNameEntered).toBe('Chinedu Eze');
    });

    it('refuses a proof photo before the package is collected', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();
      const assignmentId = await acceptJob(rider.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/proof-photo`)
        .set(asRider(rider.accessToken))
        .send({ mimeType: 'image/png', base64: TINY_PNG })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('refuses proof-of-delivery uploads onto another rider\'s job', async () => {
      const { delivery } = await jobInTransit();
      const other = await createApprovedRider(prisma, passwords, app);

      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/proof-photo`)
        .set(asRider(other.accessToken))
        .send({ mimeType: 'image/png', base64: TINY_PNG })
        .expect(404);
    });

    it('refuses to skip a step', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();
      const assignmentId = await acceptJob(rider.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);

      // Straight from ASSIGNED to PICKED_UP is not legal.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/pickup`)
        .set(asRider(rider.accessToken))
        .send({})
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('requires proof of delivery, and pays exactly once', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();
      const assignmentId = await acceptJob(rider.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);

      for (const path of ['arrive-pickup', 'pickup', 'start-transit', 'arrive-destination']) {
        await request(app.getHttpServer())
          .post(`/api/v1/rider/jobs/${delivery.id}/${path}`)
          .set(asRider(rider.accessToken))
          .send({})
          .expect(201);
      }

      // No proof at all → rejected by validation.
      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(asRider(rider.accessToken))
        .send({})
        .expect(422);

      // Wrong OTP → 422 and the attempt counter moves.
      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(asRider(rider.accessToken))
        .send({ otp: '000000' })
        .expect(422);
      const afterWrong = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(afterWrong.otpAttempts).toBe(1);

      // Photo + recipient name is the fallback and is accepted.
      const done = await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(asRider(rider.accessToken))
        .send({ proofPhotoKey: 'proof/photo.jpg', recipientNameEntered: 'Chinedu Eze', lat: 6.49, lng: 3.34 })
        .expect(201);

      expect(done.body.status).toBe('DELIVERED');
      expect(BigInt(done.body.earning.netKobo)).toBeGreaterThan(0n);

      const earning = await prisma.riderEarning.findUniqueOrThrow({ where: { deliveryId: delivery.id } });
      const deliveryRow = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(earning.netKobo + earning.commissionKobo).toBe(deliveryRow.chargeKobo);
      expect(earning.status).toBe('PENDING');

      // A second completion must not create a second payment.
      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(asRider(rider.accessToken))
        .send({ proofPhotoKey: 'proof/photo.jpg', recipientNameEntered: 'Chinedu Eze' })
        .expect(409);
      expect(await prisma.riderEarning.count({ where: { deliveryId: delivery.id } })).toBe(1);

      // The rider is free again and their counts moved.
      const freeRider = await prisma.rider.findUniqueOrThrow({ where: { id: rider.riderId } });
      expect(freeRider.availability).toBe('ONLINE');
      expect(freeRider.completedCount).toBe(1);
    });

    it('accepts the correct recipient OTP', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      const delivery = await bookDelivery();
      const assignmentId = await acceptJob(rider.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);

      for (const path of ['arrive-pickup', 'pickup', 'start-transit', 'arrive-destination']) {
        await request(app.getHttpServer())
          .post(`/api/v1/rider/jobs/${delivery.id}/${path}`)
          .set(asRider(rider.accessToken))
          .send({})
          .expect(201);
      }

      // The OTP is never exposed by the API, so it is created here the same way
      // the booking does: hash a known code and store it.
      const { createHash } = await import('node:crypto');
      const code = '432199';
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { otpHash: createHash('sha256').update(code).digest('hex'), otpAttempts: 0 },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(asRider(rider.accessToken))
        .send({ otp: code })
        .expect(201);

      expect(res.body.status).toBe('DELIVERED');
      const proof = await prisma.deliveryProof.findFirstOrThrow({ where: { deliveryId: delivery.id } });
      expect(proof.type).toBe('RECIPIENT_OTP');
      expect(proof.otpVerifiedAt).toBeTruthy();
    });

    it('hides another rider\'s job behind a 404', async () => {
      const first = await createApprovedRider(prisma, passwords, app);
      const second = await createApprovedRider(prisma, passwords, app);
      await goOnline(first.accessToken);
      const delivery = await bookDelivery();
      const assignmentId = await acceptJob(first.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(first.accessToken))
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/rider/jobs/${delivery.id}`)
        .set(asRider(second.accessToken))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/arrive-pickup`)
        .set(asRider(second.accessToken))
        .send({})
        .expect(404);
    });

    it('shows the job on the active endpoint until it is finished', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await goOnline(rider.accessToken);
      await bookDelivery();
      const assignmentId = await acceptJob(rider.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/rider/offers/${assignmentId}/accept`)
        .set(asRider(rider.accessToken))
        .expect(201);

      const active = await request(app.getHttpServer())
        .get('/api/v1/rider/jobs/active')
        .set(asRider(rider.accessToken))
        .expect(200);
      expect(active.body.status).toBe('ACCEPTED');
      expect(active.body.pay.netFormatted).toMatch(/₦/);
    });
  });

  // ──────────────────────────────── EARNINGS ────────────────────────────────

  describe('earnings and location', () => {
    it('records location pings as a time series', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);
      await request(app.getHttpServer())
        .post('/api/v1/rider/location')
        .set(asRider(rider.accessToken))
        .send({ lat: 6.45, lng: 3.4, accuracyM: 12, speedKph: 24, batteryPct: 80 })
        .expect(201);

      const rows = await prisma.riderLocation.findMany({ where: { riderId: rider.riderId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.lat).toBeCloseTo(6.45);
      expect(rows[0]!.batteryPct).toBe(80);
    });

    it('summarises earnings honestly before and after a completed job', async () => {
      const rider = await createApprovedRider(prisma, passwords, app);

      const before = await request(app.getHttpServer())
        .get('/api/v1/rider/earnings')
        .set(asRider(rider.accessToken))
        .expect(200);
      expect(before.body.availableKobo).toBe('0');
      expect(before.body.withdrawableKobo).toBe('0');

      // Simulate a completed job landing in the ledger.
      const delivery = await bookDelivery();
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { riderId: rider.riderId, status: 'DELIVERED', deliveredAt: new Date(), paymentStatus: 'PAID' },
      });
      await prisma.riderEarning.create({
        data: {
          riderId: rider.riderId,
          deliveryId: delivery.id,
          grossKobo: BigInt(delivery.chargeKobo),
          commissionKobo: 10000n,
          netKobo: BigInt(delivery.chargeKobo) - 10000n,
          status: 'AVAILABLE',
          availableAt: new Date(),
        },
      });

      const after = await request(app.getHttpServer())
        .get('/api/v1/rider/earnings')
        .set(asRider(rider.accessToken))
        .expect(200);

      expect(BigInt(after.body.availableKobo)).toBe(BigInt(delivery.chargeKobo) - 10000n);
      expect(BigInt(after.body.withdrawableKobo)).toBe(BigInt(delivery.chargeKobo) - 10000n);
      expect(after.body.deliveriesPaid).toBe(1);
    });
  });
});
