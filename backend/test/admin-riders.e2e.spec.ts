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
  resetUsers,
} from './helpers/auth-test-helpers';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * PHASE 4 — THE HUMAN HALF OF ONBOARDING
 *
 * A rider's papers are reviewed by staff, and the rider is only approved once
 * every required document is approved. These tests drive that path through the
 * HTTP API exactly as the Phase 5 admin screens will.
 */
describe('Phase 4 — admin review and rider approval', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetUsers(prisma);
    await clearRateLimits(redis);
  });

  const loginStaff = async (roleKeys: string[]) => {
    const staff = await createStaff(prisma, passwords, roleKeys);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);
    return { ...staff, accessToken: login.body.accessToken as string };
  };

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** An application waiting for review: approved=false, documents uploaded but PENDING. */
  const pendingApplication = async () => {
    const rider = await createApprovedRider(prisma, passwords, app);
    await prisma.rider.update({
      where: { id: rider.riderId },
      data: { approvalStatus: 'PENDING', approvedAt: null, reviewedAt: null, reviewedById: null },
    });
    await prisma.riderDocument.updateMany({
      where: { riderId: rider.riderId },
      data: { status: 'PENDING', reviewedAt: null, reviewedById: null },
    });
    return rider;
  };

  describe('the review queue', () => {
    it('lists pending applications with their document counts', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/riders?status=PENDING')
        .set(as(ops.accessToken))
        .expect(200);

      expect(res.body.total).toBe(1);
      const row = res.body.items[0];
      expect(row.id).toBe(rider.riderId);
      expect(row.approvalStatus).toBe('PENDING');
      expect(row.documents.pending).toBe(3);
      expect(row.documents.approved).toBe(0);
      expect(row.documents.required).toBe(3);
    });

    it('filters by search text', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      await pendingApplication();

      const none = await request(app.getHttpServer())
        .get('/api/v1/admin/riders?q=zzz-nobody')
        .set(as(ops.accessToken))
        .expect(200);
      expect(none.body.total).toBe(0);
    });

    it('shows one application with every document and the missing list', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/riders/${rider.riderId}`)
        .set(as(ops.accessToken))
        .expect(200);

      expect(res.body.documents).toHaveLength(3);
      expect(res.body.documents[0].fileKey).toMatch(/^riders\//);
      expect(res.body.canApprove).toBe(false);
      expect(res.body.missingDocuments.sort()).toEqual(['DRIVERS_LICENCE', 'NIN', 'VEHICLE_REGISTRATION']);
    });

    it('returns 404 for a rider that does not exist', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      await request(app.getHttpServer())
        .get('/api/v1/admin/riders/00000000-0000-4000-8000-000000000000')
        .set(as(ops.accessToken))
        .expect(404);
    });
  });

  describe('document review', () => {
    it('approves a document and records who did it', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();
      const document = await prisma.riderDocument.findFirstOrThrow({ where: { riderId: rider.riderId } });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/review`)
        .set(as(ops.accessToken))
        .send({ decision: 'APPROVE' })
        .expect(201);

      expect(res.body.status).toBe('APPROVED');
      const row = await prisma.riderDocument.findUniqueOrThrow({ where: { id: document.id } });
      expect(row.status).toBe('APPROVED');
      expect(row.reviewedById).not.toBeNull();
      expect(row.reviewedAt).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'RiderDocument', entityId: document.id, action: 'rider.document.approve' },
      });
      expect(audit).not.toBeNull();
    });

    it('refuses a rejection with no reason, because the rider reads it', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();
      const document = await prisma.riderDocument.findFirstOrThrow({ where: { riderId: rider.riderId } });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/review`)
        .set(as(ops.accessToken))
        .send({ decision: 'REJECT' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');

      const row = await prisma.riderDocument.findUniqueOrThrow({ where: { id: document.id } });
      expect(row.status).toBe('PENDING');
    });

    it('shows the rejection note back to the rider', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();
      const document = await prisma.riderDocument.findFirstOrThrow({
        where: { riderId: rider.riderId, docType: 'NIN' },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/review`)
        .set(as(ops.accessToken))
        .send({ decision: 'REJECT', note: 'The photo is blurred — send a clearer copy.' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/rider/profile')
        .set(as(rider.accessToken))
        .expect(200);

      const nin = res.body.documents.find((doc: { type: string }) => doc.type === 'NIN');
      expect(nin.status).toBe('REJECTED');
      expect(nin.reviewNote).toContain('blurred');
      expect(res.body.canGoOnline).toBe(false);
    });

    it('streams a document to staff who may read it, and never publicly', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();

      // Upload a real file so there are actual bytes to stream back.
      await request(app.getHttpServer())
        .post('/api/v1/rider/documents')
        .set(as(rider.accessToken))
        .send({ docType: 'NIN', mimeType: 'image/png', base64: TINY_PNG })
        .expect(201);
      const document = await prisma.riderDocument.findFirstOrThrow({
        where: { riderId: rider.riderId, docType: 'NIN' },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/file`)
        .set(as(ops.accessToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['cache-control']).toContain('no-store');

      // No token at all — the bytes of an identity document must never be public.
      await request(app.getHttpServer())
        .get(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/file`)
        .expect(401);

      // A rider's own token is not staff.
      await request(app.getHttpServer())
        .get(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/file`)
        .set(as(rider.accessToken))
        .expect(403);
    });

    it('denies document reading to a role without the permission', async () => {
      const support = await loginStaff(['SUPPORT_AGENT']);
      const rider = await pendingApplication();
      const document = await prisma.riderDocument.findFirstOrThrow({ where: { riderId: rider.riderId } });

      await request(app.getHttpServer())
        .get(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/file`)
        .set(as(support.accessToken))
        .expect(403);
    });

    it('accepts a re-upload after a rejection and resets it to pending', async () => {
      const rider = await pendingApplication();
      const document = await prisma.riderDocument.findFirstOrThrow({
        where: { riderId: rider.riderId, docType: 'NIN' },
      });
      await prisma.riderDocument.update({ where: { id: document.id }, data: { status: 'REJECTED', reviewNote: 'blurred' } });

      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/documents')
        .set(as(rider.accessToken))
        .send({ docType: 'NIN', mimeType: 'image/png', base64: TINY_PNG })
        .expect(201);

      expect(res.body.status).toBe('PENDING');
      const row = await prisma.riderDocument.findUniqueOrThrow({ where: { id: document.id } });
      expect(row.status).toBe('PENDING');
      expect(row.reviewNote).toBeNull();
    });
  });

  describe('approving the rider', () => {
    it('refuses approval while a required document is unapproved', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/approval`)
        .set(as(ops.accessToken))
        .send({ decision: 'APPROVE' })
        .expect(409);

      expect(res.body.error.code).toBe('DOCUMENTS_INCOMPLETE');
      expect(res.body.error.message).toContain('NIN');
    });

    it('approves the rider once every document is approved, and writes the audit trail', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();
      const documents = await prisma.riderDocument.findMany({ where: { riderId: rider.riderId } });

      for (const document of documents) {
        await request(app.getHttpServer())
          .post(`/api/v1/admin/riders/${rider.riderId}/documents/${document.id}/review`)
          .set(as(ops.accessToken))
          .send({ decision: 'APPROVE' })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/approval`)
        .set(as(ops.accessToken))
        .send({ decision: 'APPROVE' })
        .expect(201);

      expect(res.body.approvalStatus).toBe('APPROVED');
      expect(res.body.reviewedAt).not.toBeNull();

      const row = await prisma.rider.findUniqueOrThrow({ where: { id: rider.riderId } });
      expect(row.approvedAt).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'Rider', entityId: rider.riderId, action: 'rider.approve' },
      });
      expect(audit).not.toBeNull();
      expect((audit?.after as { staffId?: string } | null)?.staffId).toBeTruthy();

      // And now the rider can actually go online.
      await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(as(rider.accessToken))
        .send({ availability: 'ONLINE' })
        .expect(201);
    });

    it('rejects an application with a reason the rider can read', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await pendingApplication();

      await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/approval`)
        .set(as(ops.accessToken))
        .send({ decision: 'REJECT', reason: 'The licence has expired.' })
        .expect(201);

      const row = await prisma.rider.findUniqueOrThrow({ where: { id: rider.riderId } });
      expect(row.approvalStatus).toBe('REJECTED');
      expect(row.rejectionReason).toContain('expired');
      expect(row.approvedAt).toBeNull();
    });

    it('suspends a working rider, takes them offline and blocks new offers', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await createApprovedRider(prisma, passwords, app);

      await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(as(rider.accessToken))
        .send({ availability: 'ONLINE' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/approval`)
        .set(as(ops.accessToken))
        .send({ decision: 'SUSPEND', reason: 'Repeated late collections.' })
        .expect(201);

      const row = await prisma.rider.findUniqueOrThrow({ where: { id: rider.riderId } });
      expect(row.approvalStatus).toBe('SUSPENDED');
      expect(row.availability).toBe('OFFLINE');

      const res = await request(app.getHttpServer())
        .post('/api/v1/rider/availability')
        .set(as(rider.accessToken))
        .send({ availability: 'ONLINE' })
        .expect(403);
      expect(res.body.error.message).toContain('suspended');
    });

    it('will not approve the same rider twice', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      const rider = await createApprovedRider(prisma, passwords, app);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/approval`)
        .set(as(ops.accessToken))
        .send({ decision: 'APPROVE' })
        .expect(409);
      expect(res.body.error.code).toBe('DUPLICATE_REQUEST');
    });
  });

  describe('authorisation', () => {
    it('keeps riders and customers out of the review queue entirely', async () => {
      const rider = await pendingApplication();

      await request(app.getHttpServer())
        .get('/api/v1/admin/riders')
        .set(as(rider.accessToken))
        .expect(403);

      await request(app.getHttpServer())
        .get('/api/v1/admin/riders')
        .expect(401);
    });

    it('denies approval to a role without rider:approve', async () => {
      const support = await loginStaff(['SUPPORT_AGENT']);
      const rider = await pendingApplication();

      await request(app.getHttpServer())
        .post(`/api/v1/admin/riders/${rider.riderId}/approval`)
        .set(as(support.accessToken))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('requires a real password to reach any of this', async () => {
      const ops = await loginStaff(['OPERATIONS_MANAGER']);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: ops.email, password: 'WrongPassword1!', audience: 'ADMIN' })
        .expect(401);
      expect(VALID_PASSWORD).toBeTruthy();
    });
  });
});
