import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/infra/redis/redis.service';
import { PasswordService } from '../src/auth/password.service';
import { createTestApp } from './helpers/app';
import {
  VALID_PASSWORD,
  clearRateLimits,
  createStaff,
  resetUsers,
  uniquePhone,
} from './helpers/auth-test-helpers';

/**
 * LETTING A NEW ADMIN IN — AND KEEPING EVERYONE ELSE OUT.
 *
 * Three properties have to hold and none of them are visible in the UI:
 *   1. only a super admin can mint a link
 *   2. a link works exactly once, and stops working when it expires or is withdrawn
 *   3. the person who accepts chooses the password — the inviter never knows it
 *
 * Plus the display picture, which is the other half of "make the account mine":
 * uploaded through the same private storage as everything else, and readable back
 * over HTTP rather than being a URL that 404s.
 */
describe('Admin invitations and profile pictures', () => {
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

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A staff account that really is a super admin, not merely one holding the role. */
  const loginSuperAdmin = async () => {
    const staff = await createStaff(prisma, passwords, ['SUPER_ADMIN']);
    await prisma.staff.update({
      where: { userId: staff.id },
      data: { isSuperAdmin: true },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);
    return { ...staff, accessToken: login.body.accessToken as string };
  };

  const loginStaffWith = async (roleKeys: string[]) => {
    const staff = await createStaff(prisma, passwords, roleKeys);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);
    return { ...staff, accessToken: login.body.accessToken as string };
  };

  const mint = async (token: string, body: Record<string, unknown> = {}) => {
    const email = body.email as string;
    return request(app.getHttpServer())
      .post('/api/v1/admin/invites')
      .set(as(token))
      .send({ roleKeys: ['OPERATIONS_MANAGER'], ...body, email })
      .expect(201);
  };

  /** The token is the part after the last slash of the link we hand out. */
  const tokenFrom = (acceptUrl: string) => acceptUrl.split('/').pop()!;

  const accept = (token: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth/invites/${token}/accept`)
      .send({
        firstName: 'Bisi',
        lastName: 'Adeyemi',
        phone: uniquePhone(),
        password: VALID_PASSWORD,
        acceptTerms: true,
        ...body,
      });

  describe('who may invite', () => {
    it('lets a super admin mint a link, and shows it exactly once', async () => {
      const admin = await loginSuperAdmin();
      const email = `invitee-${Date.now()}@example.test`;

      const created = await mint(admin.accessToken, { email, jobTitle: 'Ops lead' });

      expect(created.body.email).toBe(email);
      expect(created.body.roleKeys).toEqual(['OPERATIONS_MANAGER']);
      expect(created.body.acceptUrl).toContain('/admin-invite/');
      // The URL carries a real token, not a placeholder.
      expect(tokenFrom(created.body.acceptUrl).length).toBeGreaterThanOrEqual(40);

      // Nothing in the response, or in the list, is a readable token.
      const list = await request(app.getHttpServer())
        .get('/api/v1/admin/invites')
        .set(as(admin.accessToken))
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(tokenFrom(created.body.acceptUrl));
      expect(list.body[0].status).toBe('PENDING');
    });

    it('refuses a non-super-admin, even one who may read the staff list', async () => {
      const ops = await loginStaffWith(['OPERATIONS_MANAGER']);

      // Minting needs staff:write, which this role does not hold.
      await request(app.getHttpServer())
        .post('/api/v1/admin/invites')
        .set(as(ops.accessToken))
        .send({ email: 'someone@example.test', roleKeys: ['SUPPORT_AGENT'] })
        .expect(403);

      // Reading the list needs only staff:read, which it DOES hold — so this 403
      // comes from the super-admin rule inside the service, not from the guard.
      const list = await request(app.getHttpServer())
        .get('/api/v1/admin/invites')
        .set(as(ops.accessToken))
        .expect(403);
      expect(list.body.error.message).toMatch(/super admin/i);
    });
  });

  describe('one use only', () => {
    it('creates the account, then refuses the same link a second time', async () => {
      const admin = await loginSuperAdmin();
      const email = `invitee-${Date.now()}@example.test`;
      const created = await mint(admin.accessToken, { email });
      const token = tokenFrom(created.body.acceptUrl);

      // The invitee can look before they leap.
      const peek = await request(app.getHttpServer())
        .get(`/api/v1/auth/invites/${token}`)
        .expect(200);
      expect(peek.body).toMatchObject({ valid: true, email });

      const accepted = await accept(token).expect(201);
      expect(accepted.body.email).toBe(email);

      // The account exists, is active, and carries the invited role.
      const staff = await prisma.user.findFirstOrThrow({
        where: { email },
        select: { type: true, status: true, staff: { select: { roles: { select: { role: { select: { key: true } } } } } } },
      });
      expect(staff.type).toBe('STAFF');
      expect(staff.status).toBe('ACTIVE');
      expect(staff.staff?.roles.map((row) => row.role.key)).toEqual(['OPERATIONS_MANAGER']);

      // …and the person who accepted can sign in with their OWN password.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(201);

      const second = await accept(token).expect(409);
      expect(second.body.error.code).toBe('INVITE_ALREADY_USED');

      const list = await request(app.getHttpServer())
        .get('/api/v1/admin/invites')
        .set(as(admin.accessToken))
        .expect(200);
      expect(list.body[0].status).toBe('ACCEPTED');
    });

    it('releases the link when the sign-up itself fails, so it can be retried', async () => {
      const admin = await loginSuperAdmin();
      const created = await mint(admin.accessToken, { email: `invitee-${Date.now()}@example.test` });
      const token = tokenFrom(created.body.acceptUrl);

      // A phone number already in use makes account creation fail…
      const taken = await loginStaffWith(['SUPPORT_AGENT']);
      const takenPhone = await prisma.user.findUniqueOrThrow({
        where: { id: taken.id },
        select: { phone: true },
      });

      await accept(token, { phone: takenPhone.phone }).expect(409);

      // …and the invitation is still usable, because nothing was created.
      await accept(token).expect(201);
    });

    it('refuses an expired link', async () => {
      const admin = await loginSuperAdmin();
      const created = await mint(admin.accessToken, { email: `invitee-${Date.now()}@example.test` });
      const token = tokenFrom(created.body.acceptUrl);

      await prisma.staffInvite.updateMany({
        where: {},
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const peek = await request(app.getHttpServer())
        .get(`/api/v1/auth/invites/${token}`)
        .expect(200);
      expect(peek.body).toEqual({ valid: false, reason: 'EXPIRED' });

      const expired = await accept(token).expect(409);
      expect(expired.body.error.code).toBe('INVITE_EXPIRED');
    });

    it('refuses a link the super admin withdrew', async () => {
      const admin = await loginSuperAdmin();
      const created = await mint(admin.accessToken, { email: `invitee-${Date.now()}@example.test` });
      const token = tokenFrom(created.body.acceptUrl);

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/invites/${created.body.id}`)
        .set(as(admin.accessToken))
        .expect(200);

      const revoked = await accept(token).expect(409);
      expect(revoked.body.error.code).toBe('INVITE_REVOKED');
    });

    it('answers an unknown link without saying which shape is real', async () => {
      const unknown = await request(app.getHttpServer())
        .get('/api/v1/auth/invites/not-a-real-token-value-at-all-000000')
        .expect(200);
      expect(unknown.body).toEqual({ valid: false, reason: 'UNKNOWN' });
    });
  });

  describe('display picture', () => {
    // A real 1×1 PNG. Small enough to inline, real enough to decode.
    const ONE_PIXEL_PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const loginCustomer = async () => {
      const email = `avatar-${Date.now()}@example.test`;
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
      return login.body.accessToken as string;
    };

    it('stores a picture and serves it back over HTTP', async () => {
      const token = await loginCustomer();

      const uploaded = await request(app.getHttpServer())
        .post('/api/v1/auth/me/avatar')
        .set(as(token))
        .send({ mimeType: 'image/png', base64: ONE_PIXEL_PNG })
        .expect(201);

      const url = uploaded.body.avatarUrl as string;
      expect(url).toMatch(/^\/api\/v1\/files\/avatars\/[0-9a-f-]+\.png$/);

      // This is the route that did not exist: every avatar in the product was a
      // broken image because nothing answered it.
      const fetched = await request(app.getHttpServer())
        .get(url.replace('/api/v1', '/api/v1'))
        .set(as(token))
        .expect(200);
      expect(fetched.headers['content-type']).toContain('image/png');

      // The profile now reports it, so the top bar has something to render.
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(as(token))
        .expect(200);
      expect(me.body.user.avatarUrl).toBe(url);

      // Removing it puts the account back to initials and the bytes are gone.
      const removed = await request(app.getHttpServer())
        .delete('/api/v1/auth/me/avatar')
        .set(as(token))
        .expect(200);
      expect(removed.body.avatarUrl).toBeNull();
      await request(app.getHttpServer()).get(url).set(as(token)).expect(404);
    });

    it('refuses an anonymous reader and every non-avatar key', async () => {
      const token = await loginCustomer();
      const uploaded = await request(app.getHttpServer())
        .post('/api/v1/auth/me/avatar')
        .set(as(token))
        .send({ mimeType: 'image/png', base64: ONE_PIXEL_PNG })
        .expect(201);

      await request(app.getHttpServer()).get(uploaded.body.avatarUrl).expect(401);

      // Rider documents and parcel photos have their own endpoints with their own
      // rules; this generic reader must never become a way around them.
      await request(app.getHttpServer())
        .get('/api/v1/files/riders/some-rider/documents/leak.jpg')
        .set(as(token))
        .expect(404);
    });

    it('rejects anything that is not an image', async () => {
      const token = await loginCustomer();
      const rejected = await request(app.getHttpServer())
        .post('/api/v1/auth/me/avatar')
        .set(as(token))
        .send({ mimeType: 'application/pdf', base64: ONE_PIXEL_PNG })
        .expect(422);
      expect(rejected.body.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
