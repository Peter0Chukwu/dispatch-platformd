import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service';
import type { RedisService } from '../src/infra/redis/redis.service';
import type { PasswordService } from '../src/auth/password.service';
import { ReportsService } from '../src/reports/reports.service';
import { ReportDatasetsService } from '../src/reports/report-datasets.service';
import { AdminFinanceService } from '../src/admin/admin-finance.service';
import { createTestApp } from './helpers/app';
import {
  clearRateLimits,
  createStaff,
  registerAndActivateCustomer,
  resetUsers,
} from './helpers/auth-test-helpers';

/**
 * PHASE 9 — REPORTS AND ANALYTICS
 *
 * The thesis of this suite: a report is not a picture of the data, it is an
 * *assertion about it*. So every test here ends one of two ways:
 *
 *   · the totals in the report equal the number the dashboard or the ledger shows;
 *   · or the report refuses to be produced/downloaded by somebody who should not
 *     have it.
 *
 * Covered:
 *   · the catalogue, and the permission that guards it;
 *   · queueing a report returns instantly with a job, not a file;
 *   · the worker renders it, the file is private, and the download needs a signed,
 *     expiring token;
 *   · a tampered or expired token is refused;
 *   · CSV money is spreadsheet-safe, PDF is a real PDF;
 *   · every report's totals agree with the finance screen, the ledger and SQL.
 */
describe('Phase 9 — reports and analytics', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;
  let reports: ReportsService;
  let datasets: ReportDatasetsService;
  let finance: AdminFinanceService;

  const PICKUP = { address: '12 Adeola Odeku Street, Victoria Island', lat: 6.4281, lng: 3.4219 };
  const DEST = { address: '5 Bode Thomas Street, Surulere', lat: 6.4969, lng: 3.3481 };

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
    reports = app.get(ReportsService);
    datasets = app.get(ReportDatasetsService);
    finance = app.get(AdminFinanceService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetUsers(prisma);
    await clearRateLimits(redis);
    await prisma.reportRequest.deleteMany({});
    await prisma.riderEarning.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.delivery.deleteMany({});
  });

  /* ───────────────────────────── helpers ───────────────────────────── */

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  const loginStaff = async (roleKeys: string[]) => {
    const staff = await createStaff(prisma, passwords, roleKeys);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);
    return { ...staff, accessToken: login.body.accessToken as string };
  };

  /** A paid delivery, created the way a customer creates one. */
  const paidDelivery = async (token: string, overrides: { chargeKobo?: bigint } = {}) => {
    const booking = await request(app.getHttpServer())
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

    const init = await request(app.getHttpServer())
      .post(`/api/v1/payments/deliveries/${booking.body.id}/initialize`)
      .set(as(token))
      .send({ provider: 'PAYSTACK' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${init.body.reference}/simulate`)
      .set(as(token))
      .expect(201);

    if (overrides.chargeKobo) {
      await prisma.delivery.update({ where: { id: booking.body.id }, data: { chargeKobo: overrides.chargeKobo } });
    }
    return { id: booking.body.id as string, reference: booking.body.reference as string };
  };

  /** Wait for the worker (or run it ourselves) until the job is READY. */
  const waitForReady = async (id: string, attempts = 20) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const job = await prisma.reportRequest.findUniqueOrThrow({ where: { id } });
      if (job.status === 'READY' || job.status === 'FAILED') return job;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('report never finished');
  };

  /* ───────────────────────── 1. catalogue & access ───────────────────────── */

  describe('the catalogue', () => {
    it('lists all nine reports for a role that may generate them', async () => {
      const admin = await loginStaff(['SUPER_ADMIN']);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/reports/catalogue')
        .set(as(admin.accessToken))
        .expect(200);

      expect(res.body.data).toHaveLength(9);
      expect(res.body.data.map((row: { type: string }) => row.type)).toContain('FINANCIAL_SUMMARY');
      expect(res.body.data.every((row: { formats: string[] }) => row.formats.join() === 'CSV,PDF')).toBe(true);
    });

    it('refuses a support agent, who has no report:generate', async () => {
      const support = await loginStaff(['SUPPORT_AGENT']);
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/reports/catalogue')
        .set(as(support.accessToken))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('refuses a customer token outright', async () => {
      const customer = await registerAndActivateCustomer(app);
      await request(app.getHttpServer())
        .get('/api/v1/admin/reports/catalogue')
        .set(as(customer.accessToken))
        .expect(403);
    });
  });

  /* ───────────────────── 2. queueing is instant ───────────────────── */

  describe('requesting a report', () => {
    it('answers immediately with a QUEUED job instead of rendering inline', async () => {
      const customer = await registerAndActivateCustomer(app);
      await paidDelivery(customer.accessToken);
      const admin = await loginStaff(['FINANCE_MANAGER']);

      const started = Date.now();
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'FINANCIAL_SUMMARY', format: 'CSV' })
        .expect(201);
      const elapsed = Date.now() - started;

      expect(res.body.status).toBe('QUEUED');
      expect(res.body.downloadable).toBe(false);
      // The whole point: the request does not wait for the file.
      expect(elapsed).toBeLessThan(2000);
    });

    it('rejects an unknown report type and a backwards period', async () => {
      const admin = await loginStaff(['SUPER_ADMIN']);

      await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'EVERYTHING', format: 'CSV' })
        .expect(422);

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'REVENUE', format: 'CSV', from: '2026-03-01', to: '2026-01-01' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a download link while the report is still queued', async () => {
      const admin = await loginStaff(['SUPER_ADMIN']);
      const job = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'REVENUE', format: 'CSV' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/reports/${job.body.id}/download-link`)
        .set(as(admin.accessToken))
        .expect(409);
    });
  });

  /* ───────────────── 3. rendering, storage and download ───────────────── */

  describe('the worker and the signed download', () => {
    it('renders a CSV that a spreadsheet can sum, then serves it over a signed link', async () => {
      const customer = await registerAndActivateCustomer(app);
      await paidDelivery(customer.accessToken);
      const admin = await loginStaff(['FINANCE_MANAGER']);

      const job = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'DAILY_DELIVERIES', format: 'CSV' })
        .expect(201);

      await reports.process(job.body.id);
      const stored = await prisma.reportRequest.findUniqueOrThrow({ where: { id: job.body.id } });
      expect(stored.status).toBe('READY');
      expect(stored.fileKey).toMatch(/^reports\//);

      const link = await request(app.getHttpServer())
        .post(`/api/v1/admin/reports/${job.body.id}/download-link`)
        .set(as(admin.accessToken))
        .expect(201);
      expect(link.body.url).toContain('/api/v1/reports/download/');

      const file = await request(app.getHttpServer()).get(link.body.url).expect(200);
      expect(file.headers['content-type']).toContain('text/csv');
      expect(file.headers['content-disposition']).toContain('attachment');

      const csv = file.text ?? String(file.body);
      expect(csv).toContain('Daily deliveries');
      // Money is a plain naira decimal, never ₦4,894.50 — SUM() must work.
      expect(csv).toMatch(/\d+\.\d{2}/);
      expect(csv).not.toContain('₦');
      expect(csv).toContain('# Totals');
    });

    it('produces a real PDF for the same data', async () => {
      const customer = await registerAndActivateCustomer(app);
      await paidDelivery(customer.accessToken);
      const admin = await loginStaff(['FINANCE_MANAGER']);

      const job = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'FINANCIAL_SUMMARY', format: 'PDF' })
        .expect(201);
      await reports.process(job.body.id);

      const link = await reports.downloadLink(job.body.id);
      const file = await reports.readDownload(link.url.split('/').pop()!);
      expect(file.contentType).toBe('application/pdf');
      expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(file.buffer.length).toBeGreaterThan(1500);
    });

    it('refuses a tampered signature and an expired link', async () => {
      const admin = await loginStaff(['FINANCE_MANAGER']);
      const job = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'CUSTOMERS', format: 'CSV' })
        .expect(201);
      await reports.process(job.body.id);

      const link = await reports.downloadLink(job.body.id);
      const token = link.url.split('/').pop()!;
      const [payload, signature = ''] = token.split('.');

      const tampered = `${Buffer.from(`${job.body.id}.9999999999`).toString('base64url')}.${signature}`;
      await request(app.getHttpServer()).get(`/api/v1/reports/download/${tampered}`).expect(403);

      const wrongSignature = `${payload}.${signature.slice(0, -3)}abc`;
      await request(app.getHttpServer()).get(`/api/v1/reports/download/${wrongSignature}`).expect(403);

      // A link minted with a TTL in the past is refused even when the signature is good.
      const expired = await reports.downloadLink(job.body.id, -60);
      await request(app.getHttpServer()).get(expired.url.replace('/api/v1', '/api/v1')).expect(403);
    });

    it('claims a job once: a second process() call does not render it again', async () => {
      const admin = await loginStaff(['SUPER_ADMIN']);
      const job = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'ZONE_PERFORMANCE', format: 'CSV' })
        .expect(201);

      const first = await reports.process(job.body.id);
      const second = await reports.process(job.body.id);
      expect(first.status).toBe('READY');
      expect(second.status).toBe('FAILED');

      const row = await prisma.reportRequest.findUniqueOrThrow({ where: { id: job.body.id } });
      expect(row.status).toBe('READY');
    });

    it('recovers a job left in PROCESSING by a crash', async () => {
      const admin = await loginStaff(['SUPER_ADMIN']);
      const job = await request(app.getHttpServer())
        .post('/api/v1/admin/reports')
        .set(as(admin.accessToken))
        .send({ type: 'REVENUE', format: 'CSV' })
        .expect(201);

      await prisma.reportRequest.update({
        where: { id: job.body.id },
        data: { status: 'PROCESSING', createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
      const requeued = await reports.requeueStale();
      expect(requeued).toBeGreaterThanOrEqual(1);

      const row = await prisma.reportRequest.findUniqueOrThrow({ where: { id: job.body.id } });
      expect(row.status).toBe('QUEUED');
    });
  });

  /* ───────────────── 4. the totals reconcile ─────────────────  */

  describe('reconciliation with the rest of the platform', () => {
    it('delivered revenue in the report equals the sum of delivered charges in SQL', async () => {
      const customer = await registerAndActivateCustomer(app);
      const first = await paidDelivery(customer.accessToken);
      const second = await paidDelivery(customer.accessToken, { chargeKobo: 500_000n });
      await prisma.delivery.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { status: 'DELIVERED', deliveredAt: new Date() } });

      const expected = await prisma.delivery.aggregate({ where: { status: 'DELIVERED' }, _sum: { chargeKobo: true } });
      const table = await datasets.build('DAILY_DELIVERIES', new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000));

      const revenue = table.totals.find((total) => total.label === 'Delivered revenue');
      expect(revenue).toBeTruthy();
      expect(BigInt(revenue!.value)).toBe(expected._sum.chargeKobo ?? 0n);
      expect(table.totals.find((total) => total.label === 'Delivered')?.value).toBe(2);
    });

    it('the financial summary net equals the finance screen net', async () => {
      const customer = await registerAndActivateCustomer(app);
      await paidDelivery(customer.accessToken);

      const from = new Date(Date.now() - 7 * 86_400_000);
      const to = new Date(Date.now() + 60_000);
      const [summary, table] = await Promise.all([
        finance.summary(from, to),
        datasets.build('FINANCIAL_SUMMARY', from, to),
      ]);

      const net = table.totals.find((total) => total.label === 'Net');
      expect(net).toBeTruthy();
      // The finance screen reports netKobo as a string; the report carries kobo.
      expect(String(net!.value)).toBe(String(summary.net.kobo));
    });

    it('collected in the revenue report equals settled payments in SQL', async () => {
      const customer = await registerAndActivateCustomer(app);
      await paidDelivery(customer.accessToken);
      await paidDelivery(customer.accessToken);

      const settled = await prisma.payment.aggregate({ where: { status: 'SUCCESS' }, _sum: { amountKobo: true } });
      const table = await datasets.build('REVENUE', new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000));

      const collected = table.totals.find((total) => total.label === 'Collected');
      expect(BigInt(collected!.value)).toBe(settled._sum.amountKobo ?? 0n);
      // And the net line is collected minus fees, not an independently computed number.
      const fees = table.totals.find((total) => total.label === 'Gateway fees')!;
      const netLine = table.totals.find((total) => total.label === 'Net after fees')!;
      expect(BigInt(netLine.value)).toBe(BigInt(collected!.value) - BigInt(fees.value));
    });

    it('rider earnings add up: gross − commission = net, for every row and in total', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await paidDelivery(customer.accessToken);
      const riderUser = await prisma.user.create({
        data: {
          email: `rider-earn-${Date.now()}@dispatch.test`,
          phone: `+23481${Math.floor(Math.random() * 100_000_000)}`,
          passwordHash: await passwords.hash('Rider@12345'),
          type: 'RIDER',
          status: 'ACTIVE',
          firstName: 'Rita',
          lastName: 'Rider',
          rider: {
            create: {
              riderCode: `RDR-R${Date.now() % 10_000}`,
              branchId: (await prisma.branch.findFirstOrThrow()).id,
              approvalStatus: 'APPROVED',
            },
          },
        },
        select: { rider: { select: { id: true } } },
      });
      await prisma.riderEarning.create({
        data: {
          riderId: riderUser.rider!.id,
          deliveryId: delivery.id,
          grossKobo: 500_000n,
          commissionKobo: 100_000n,
          netKobo: 400_000n,
          status: 'AVAILABLE',
          availableAt: new Date(Date.now() - 1000),
        },
      });

      const table = await datasets.build('RIDER_EARNINGS', new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000));
      const row = table.rows.find((candidate) => candidate.deliveries === 1)!;
      expect(Number(row.grossKobo) - Number(row.commissionKobo)).toBe(Number(row.netKobo));

      const gross = table.totals.find((total) => total.label === 'Gross earnings')!;
      const commission = table.totals.find((total) => total.label === 'Commission')!;
      const net = table.totals.find((total) => total.label === 'Net owed to riders')!;
      expect(BigInt(gross.value) - BigInt(commission.value)).toBe(BigInt(net.value));
      expect(BigInt(net.value)).toBe(400_000n);
    });

    it('the preview endpoint returns the same totals without writing a file', async () => {
      const customer = await registerAndActivateCustomer(app);
      await paidDelivery(customer.accessToken);
      const admin = await loginStaff(['FINANCE_MANAGER']);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/reports/preview?type=FINANCIAL_SUMMARY')
        .set(as(admin.accessToken))
        .expect(200);

      expect(res.body.columns.length).toBeGreaterThan(0);
      expect(res.body.totalsFormatted.length).toBeGreaterThan(0);
      expect(res.body.rows.length).toBeLessThanOrEqual(25);
      const net = res.body.totalsFormatted.find((total: { label: string }) => total.label === 'Net');
      expect(net.value).toMatch(/^-?\d+$/);
      // No file was written by a preview.
      expect(await prisma.reportRequest.count()).toBe(0);
    });
  });
});
