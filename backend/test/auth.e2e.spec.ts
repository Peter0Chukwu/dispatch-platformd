import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
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

const REGISTER = '/api/v1/auth/register/customer';

describe('Phase 2 — authentication, sessions and access control', () => {
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

  // ───────────────────────────── REGISTRATION ──────────────────────────────

  describe('registration', () => {
    it('creates a PENDING customer with a wallet and issues verification codes', async () => {
      const email = uniqueEmail();
      const phone = uniquePhone();

      const res = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email, phone, password: VALID_PASSWORD, acceptTerms: true })
        .expect(201);

      expect(res.body.userId).toBeTruthy();
      expect(res.body.verification.devToken).toBeTruthy();
      expect(res.body.verification.devCode).toMatch(/^\d{6}$/);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { customer: true, wallet: true },
      });
      expect(user.status).toBe('PENDING');
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.customer).not.toBeNull();
      expect(user.wallet?.balanceKobo).toBe(0n);
      // The password must never be recoverable from the record.
      expect(user.passwordHash).not.toContain(VALID_PASSWORD);
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('rejects a duplicate email with 409', async () => {
      const email = uniqueEmail();
      const body = { firstName: 'Ada', lastName: 'Okafor', email, phone: uniquePhone(), password: VALID_PASSWORD, acceptTerms: true };
      await request(app.getHttpServer()).post(REGISTER).send(body).expect(201);
      const res = await request(app.getHttpServer()).post(REGISTER).send({ ...body, phone: uniquePhone() }).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rejects a weak password at the API boundary (not just in the browser)', async () => {
      const res = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email: uniqueEmail(), phone: uniquePhone(), password: 'password', acceptTerms: true })
        .expect(422);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const fields = res.body.error.details.map((d: { field?: string }) => d.field);
      expect(fields).toContain('password');
    });

    it('rejects an invalid Nigerian phone number', async () => {
      const res = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email: uniqueEmail(), phone: '12345', password: VALID_PASSWORD, acceptTerms: true })
        .expect(422);
      expect(res.body.error.details.some((d: { field?: string }) => d.field === 'phone')).toBe(true);
    });

    it('normalises phone numbers so the same person cannot register twice', async () => {
      const phone = uniquePhone(); // +23480xxxxxxxx
      const localFormat = `0${phone.slice(4)}`; // 080xxxxxxxx
      await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email: uniqueEmail(), phone, password: VALID_PASSWORD, acceptTerms: true })
        .expect(201);

      await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email: uniqueEmail(), phone: localFormat, password: VALID_PASSWORD, acceptTerms: true })
        .expect(409);
    });
  });

  // ───────────────────────────── VERIFICATION ──────────────────────────────

  describe('email and phone verification', () => {
    it('activates the account once the email link is used, and refuses to reuse the link', async () => {
      const register = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email: uniqueEmail(), phone: uniquePhone(), password: VALID_PASSWORD, acceptTerms: true })
        .expect(201);

      const token = register.body.verification.devToken;
      await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(201);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: register.body.userId } });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.status).toBe('ACTIVE');

      const replay = await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(400);
      expect(replay.body.error.message).toMatch(/already been used/i);
    });

    it('rejects a wrong OTP and accepts the correct one', async () => {
      const phone = uniquePhone();
      const register = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email: uniqueEmail(), phone, password: VALID_PASSWORD, acceptTerms: true })
        .expect(201);

      const wrong = register.body.verification.devCode === '000000' ? '111111' : '000000';
      await request(app.getHttpServer()).post('/api/v1/auth/otp/verify').send({ phone, code: wrong }).expect(400);

      await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone, code: register.body.verification.devCode })
        .expect(201);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: register.body.userId } });
      expect(user.phoneVerifiedAt).not.toBeNull();
    });

    it('does not store the OTP in plain text', async () => {
      const phone = uniquePhone();
      const register = await request(app.getHttpServer())
        .post(REGISTER)
        .send({ firstName: 'Ada', lastName: 'Okafor', email: uniqueEmail(), phone, password: VALID_PASSWORD, acceptTerms: true })
        .expect(201);

      const token = await prisma.verificationToken.findFirstOrThrow({
        where: { userId: register.body.userId, purpose: 'PHONE_OTP' },
      });
      expect(token.tokenHash).not.toBe(register.body.verification.devCode);
      expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ──────────────────────────────── LOGIN ──────────────────────────────────

  describe('login', () => {
    it('signs in and returns an access token but never the refresh token in the body', async () => {
      const { email } = await registerAndActivateCustomer(app);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(201);

      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeUndefined();
      expect(res.body.user.email).toBe(email);
      expect(res.body.profile.customerId).toBeTruthy();

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const refreshCookie = cookies.find((c) => c.startsWith('dispatch_refresh='));
      expect(refreshCookie).toBeTruthy();
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/i);
    });

    it('accepts a phone number as the login identifier', async () => {
      const { phone } = await registerAndActivateCustomer(app);
      const local = `0${phone.slice(4)}`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: local, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(201);
    });

    it('gives the same generic error for a wrong password and an unknown account', async () => {
      const { email } = await registerAndActivateCustomer(app);

      const wrongPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: 'WrongPassw0rd', audience: 'CUSTOMER' })
        .expect(401);

      await clearRateLimits(redis);
      const unknownUser = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: uniqueEmail('ghost'), password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(401);

      expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
    });

    it('counts failed attempts', async () => {
      const { email, userId } = await registerAndActivateCustomer(app);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: 'WrongPassw0rd', audience: 'CUSTOMER' })
        .expect(401);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.failedLogins).toBe(1);
    });

    it('locks the account after five failed attempts and audits it', async () => {
      const { email, userId } = await registerAndActivateCustomer(app);

      let last;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        last = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ identifier: email, password: 'WrongPassw0rd', audience: 'CUSTOMER' });
      }
      expect(last!.status).toBe(401);

      // Even the correct password is refused while locked.
      const locked = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(429);
      expect(locked.body.error.code).toBe('RATE_LIMITED');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.lockedUntil).not.toBeNull();

      const auditRow = await prisma.auditLog.findFirst({ where: { action: 'ACCOUNT_LOCKED', entityId: userId } });
      expect(auditRow).not.toBeNull();
    });

    it('refuses a customer account in the admin portal (and says why)', async () => {
      const { email } = await registerAndActivateCustomer(app);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(403);
      expect(res.body.error.message).toMatch(/cannot sign in to the admin portal/i);
    });

    it('refuses a suspended account', async () => {
      const { email, userId } = await registerAndActivateCustomer(app);
      await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(403);
      expect(res.body.error.message).toMatch(/suspended/i);
    });
  });

  // ─────────────────────────────── SESSIONS ────────────────────────────────

  describe('sessions and refresh-token rotation', () => {
    it('returns the authenticated profile at /auth/me', async () => {
      const { accessToken } = await registerAndActivateCustomer(app);
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.user.type).toBe('CUSTOMER');
    });

    it('requires a token and rejects a malformed one', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an expired access token', async () => {
      const { userId } = await registerAndActivateCustomer(app);
      const jwt = new JwtService({});
      const expired = await jwt.signAsync(
        { sub: userId, typ: 'CUSTOMER', aud: 'CUSTOMER', sid: 'x', jti: 'y' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '-10s' },
      );
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
      expect(res.body.error.message).toMatch(/expired/i);
    });

    it('rotates the refresh token and keeps the old one unusable', async () => {
      const { cookies } = await registerAndActivateCustomer(app);
      const firstCookie = cookies.find((c) => c.startsWith('dispatch_refresh='))!;

      const first = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', firstCookie).expect(201);
      expect(first.body.accessToken).toBeTruthy();

      // The rotated token is a DIFFERENT value.
      const newCookie = (first.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('dispatch_refresh='),
      )!;
      expect(newCookie).not.toBe(firstCookie);
    });

    it('detects refresh-token reuse and revokes the whole session family', async () => {
      const { cookies } = await registerAndActivateCustomer(app);
      const stolen = cookies.find((c) => c.startsWith('dispatch_refresh='))!;

      // Legitimate client rotates once.
      const rotated = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', stolen).expect(201);
      const validCookie = (rotated.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('dispatch_refresh='),
      )!;

      // Attacker replays the old token → reuse detected.
      const reuse = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', stolen).expect(401);
      expect(reuse.body.error.message).toMatch(/signed out|sign in again/i);

      // …and the legitimate token is now dead too, because the family was revoked.
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', validCookie).expect(401);
    });

    it('revokes the session on logout', async () => {
      const { cookies } = await registerAndActivateCustomer(app);
      const cookie = cookies.find((c) => c.startsWith('dispatch_refresh='))!;

      await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookie).expect(201);
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('logs out of every device on demand', async () => {
      const { email, accessToken } = await registerAndActivateCustomer(app);
      const second = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(201);
      const secondCookie = (second.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('dispatch_refresh='),
      )!;

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', secondCookie).expect(401);
    });
  });

  // ──────────────────────────── AUTHORISATION ─────────────────────────────

  describe('role-based access control', () => {
    it('blocks a customer from the admin portal entirely', async () => {
      const { accessToken } = await registerAndActivateCustomer(app);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/whoami')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('blocks an authenticated rider from admin endpoints', async () => {
      const email = uniqueEmail('rider');
      const phone = uniquePhone();

      const register = await request(app.getHttpServer())
        .post('/api/v1/auth/register/rider')
        .send({
          firstName: 'Musa',
          lastName: 'Ibrahim',
          email,
          phone,
          password: VALID_PASSWORD,
          addressLine: '14 Adeola Odeku Street, Victoria Island',
          city: 'Lagos',
          state: 'Lagos',
          vehicleType: 'MOTORCYCLE',
          vehicleRegistrationNumber: `KJA-${Math.floor(Math.random() * 900) + 100}-XY`,
          emergencyContactName: 'Hauwa Ibrahim',
          emergencyContactPhone: uniquePhone(),
          acceptTerms: true,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: register.body.verification.devToken })
        .expect(201);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'RIDER' })
        .expect(201);

      // A valid rider session exists…
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      // …but every admin route refuses it.
      for (const route of ['/api/v1/admin/whoami', '/api/v1/admin/staff', '/api/v1/admin/audit-logs']) {
        const res = await request(app.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${login.body.accessToken}`)
          .expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('a new rider is PENDING and cannot sign in to the admin portal', async () => {
      const email = uniqueEmail('rider');
      await request(app.getHttpServer())
        .post('/api/v1/auth/register/rider')
        .send({
          firstName: 'Musa',
          lastName: 'Ibrahim',
          email,
          phone: uniquePhone(),
          password: VALID_PASSWORD,
          addressLine: '14 Adeola Odeku Street, Victoria Island',
          city: 'Lagos',
          state: 'Lagos',
          vehicleType: 'MOTORCYCLE',
          vehicleRegistrationNumber: `LSD-${Math.floor(Math.random() * 900) + 100}-QA`,
          emergencyContactName: 'Hauwa Ibrahim',
          emergencyContactPhone: uniquePhone(),
          acceptTerms: true,
        })
        .expect(201);

      const rider = await prisma.rider.findFirstOrThrow({ where: { user: { email } } });
      expect(rider.approvalStatus).toBe('PENDING');

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(403);
    });

    it('a support agent can open the dashboard but NOT the staff directory', async () => {
      const agent = await createStaff(prisma, passwords, ['SUPPORT_AGENT']);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: agent.email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(201);
      const token = login.body.accessToken as string;

      expect(login.body.profile.roles).toContain('SUPPORT_AGENT');
      expect(login.body.profile.permissions).not.toContain('withdrawal:approve');
      expect(login.body.profile.permissions).not.toContain('pricing:write');

      await request(app.getHttpServer())
        .get('/api/v1/admin/whoami')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const denied = await request(app.getHttpServer())
        .get('/api/v1/admin/staff')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      expect(denied.body.error.details?.[0]?.message).toMatch(/Missing permission: staff:read/);
    });

    it('an operations manager can read staff but cannot read the audit log', async () => {
      const manager = await createStaff(prisma, passwords, ['OPERATIONS_MANAGER']);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: manager.email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(201);
      const token = login.body.accessToken as string;

      await request(app.getHttpServer()).get('/api/v1/admin/staff').set('Authorization', `Bearer ${token}`).expect(200);
      await request(app.getHttpServer()).get('/api/v1/admin/audit-logs').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('a finance manager can read the audit log and the permission catalogue is still protected', async () => {
      const finance = await createStaff(prisma, passwords, ['FINANCE_MANAGER']);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: finance.email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(201);
      const token = login.body.accessToken as string;

      await request(app.getHttpServer()).get('/api/v1/admin/audit-logs').set('Authorization', `Bearer ${token}`).expect(200);
      // Finance managers may not edit roles.
      await request(app.getHttpServer()).get('/api/v1/admin/permissions').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('a super administrator can do everything', async () => {
      const admin = await createStaff(prisma, passwords, ['SUPER_ADMIN']);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: admin.email, password: VALID_PASSWORD, audience: 'ADMIN' })
        .expect(201);
      const token = login.body.accessToken as string;

      await request(app.getHttpServer()).get('/api/v1/admin/whoami').set('Authorization', `Bearer ${token}`).expect(200);
      const staff = await request(app.getHttpServer())
        .get('/api/v1/admin/staff')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(staff.body.data.length).toBeGreaterThanOrEqual(1);
      await request(app.getHttpServer()).get('/api/v1/admin/permissions').set('Authorization', `Bearer ${token}`).expect(200);
    });
  });

  // ────────────────────────────── PASSWORDS ───────────────────────────────

  describe('password management', () => {
    it('completes a reset and invalidates every existing session', async () => {
      const { email, cookies } = await registerAndActivateCustomer(app);
      const cookie = cookies.find((c) => c.startsWith('dispatch_refresh='))!;

      const forgot = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ identifier: email })
        .expect(201);
      expect(forgot.body.devToken).toBeTruthy();

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ token: forgot.body.devToken, password: 'N3wStrongPassw0rd' })
        .expect(201);

      // Old password fails, new password works.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(401);
      await clearRateLimits(redis);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: 'N3wStrongPassw0rd', audience: 'CUSTOMER' })
        .expect(201);

      // Sessions created before the reset are dead.
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('does not reveal whether an account exists', async () => {
      const known = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ identifier: uniqueEmail('nobody') })
        .expect(201);
      expect(known.body.message).toMatch(/if an account matches/i);
      expect(known.body.devToken).toBeUndefined();
    });

    it('changes a password and signs out other devices', async () => {
      const { email, accessToken } = await registerAndActivateCustomer(app);
      const other = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(201);
      const otherCookie = (other.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('dispatch_refresh='),
      )!;

      await request(app.getHttpServer())
        .patch('/api/v1/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: VALID_PASSWORD, newPassword: 'An0therStrongPass' })
        .expect(200);

      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', otherCookie).expect(401);
    });

    it('rejects a wrong current password', async () => {
      const { accessToken } = await registerAndActivateCustomer(app);
      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'NotMyPassword1', newPassword: 'An0therStrongPass' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // ──────────────────────────── RATE LIMITING ─────────────────────────────

  describe('rate limiting', () => {
    it('returns 429 after too many sign-in attempts on one account', async () => {
      const { email } = await registerAndActivateCustomer(app);
      await clearRateLimits(redis);

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ identifier: email, password: 'WrongPassw0rd', audience: 'CUSTOMER' });
        statuses.push(res.status);
      }

      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      const limited = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: VALID_PASSWORD, audience: 'CUSTOMER' })
        .expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(limited.body.error.message).toMatch(/wait/i);
    });
  });

  // ────────────────────────────── AUDIT LOG ───────────────────────────────

  describe('audit trail', () => {
    it('records successful and failed sign-ins', async () => {
      const { email, userId } = await registerAndActivateCustomer(app);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: 'WrongPassw0rd', audience: 'CUSTOMER' })
        .expect(401);

      const actions = await prisma.auditLog.findMany({
        where: { actorUserId: userId },
        select: { action: true },
      });
      const actionNames = actions.map((a) => a.action);
      expect(actionNames).toContain('CUSTOMER_REGISTERED');
      expect(actionNames).toContain('LOGIN_SUCCESS');
      expect(actionNames).toContain('LOGIN_FAILED');
    });

    it('never stores a password or token in the audit log', async () => {
      const { userId } = await registerAndActivateCustomer(app);
      const rows = await prisma.auditLog.findMany({ where: { actorUserId: userId } });
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toContain(VALID_PASSWORD);
      expect(serialised).not.toContain('$argon2');
    });
  });
});
