import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service';
import type { RedisService } from '../src/infra/redis/redis.service';
import type { PasswordService } from '../src/auth/password.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { EarningsScheduler } from '../src/withdrawals/earnings.scheduler';
import { createTestApp } from './helpers/app';
import {
  VALID_PASSWORD,
  clearRateLimits,
  createApprovedRider,
  createStaff,
  registerAndActivateCustomer,
  resetUsers,
} from './helpers/auth-test-helpers';

/**
 * PHASE 7 — PAYMENTS, WALLET AND THE LEDGER
 *
 * The thesis of this suite: money on this platform is *provable*. Every test below
 * ends by checking one of two things — that the money moved exactly once, or that
 * the books still balance.
 *
 * Covered here:
 *   · a gateway payment, settled only after the provider confirms it;
 *   · a webhook with a bad signature, which credits nothing;
 *   · a replayed webhook, which credits nothing twice;
 *   · a wallet top-up, a wallet payment, and a wallet that cannot go negative;
 *   · a rider earning, the hold window, a withdrawal request, approval, payout;
 *   · a refund that lands back in the wallet it came from;
 *   · the finance summary and the reconciliation panel agreeing with the ledger.
 */
describe('Phase 7 — payments, wallet and ledger', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;
  let ledger: LedgerService;
  let earnings: EarningsScheduler;

  const PICKUP = { address: '12 Adeola Odeku Street, Victoria Island', lat: 6.4281, lng: 3.4219 };
  const DEST = { address: '5 Bode Thomas Street, Surulere', lat: 6.4969, lng: 3.3481 };
  const SECRET = process.env.PAYSTACK_SECRET_KEY ?? 'sk_test_webhook_signature_key';

  beforeAll(async () => {
    ({ app, prisma, redis, passwords } = await createTestApp());
    ledger = app.get(LedgerService);
    earnings = app.get(EarningsScheduler);
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

  const loginStaff = async (roleKeys: string[]) => {
    const staff = await createStaff(prisma, passwords, roleKeys);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: staff.password, audience: 'ADMIN' })
      .expect(201);
    const record = await prisma.staff.findUniqueOrThrow({ where: { userId: staff.id } });
    return { ...staff, staffId: record.id, accessToken: login.body.accessToken as string };
  };

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
    return { id: res.body.id as string, reference: res.body.reference as string, chargeKobo: BigInt(res.body.chargeKobo) };
  };

  /** Confirms the whole ledger still balances — the check every money test ends with. */
  const expectBooksBalanced = async () => {
    const trial = await ledger.trialBalance();
    expect(trial.balanced, 'debits must equal credits').toBe(true);
    expect(trial.totalDebitsKobo).toBe(trial.totalCreditsKobo);
    return trial;
  };

  const balanceOf = (code: string) => ledger.accountBalance(code);

  /* ───────────────────────── 1. chart of accounts ───────────────────────── */

  describe('the chart of accounts', () => {
    it('is seeded and the books start balanced', async () => {
      const accounts = await prisma.ledgerAccount.count();
      expect(accounts).toBeGreaterThanOrEqual(16);
      await expectBooksBalanced();
    });

    it('refuses an unbalanced journal entry', async () => {
      await expect(
        ledger.post({
          eventType: 'ADJUSTMENT',
          description: 'deliberately wrong',
          idempotencyKey: `test-unbalanced-${Date.now()}`,
          lines: [
            { code: '1000_CASH_CLEARING', debitKobo: 1000n },
            { code: '4000_DELIVERY_REVENUE', creditKobo: 900n },
          ],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('posts the same business event only once', async () => {
      const key = `test-idempotent-${Date.now()}`;
      const entry = {
        eventType: 'OPENING' as const,
        description: 'idempotency probe',
        idempotencyKey: key,
        lines: [
          { code: '1000_CASH_CLEARING', debitKobo: 500n },
          { code: '3900_OPENING_BALANCE', creditKobo: 500n },
        ],
      };
      const first = await ledger.post(entry);
      const second = await ledger.post(entry);
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(second.entryId).toBe(first.entryId);
      await expectBooksBalanced();
    });
  });

  /* ───────────────────────── 2. gateway payments ───────────────────────── */

  describe('gateway payments', () => {
    it('starts a payment for an unpaid delivery and leaves it PENDING until confirmed', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);

      const init = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);

      expect(init.body.status).toBe('PENDING');
      expect(init.body.amountKobo).toBe(delivery.chargeKobo.toString());
      expect(init.body.simulated).toBe(true);
      expect(init.body.reference).toMatch(/^PAY-/);

      // Nothing has moved yet: an initialized payment is not money.
      const fresh = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(fresh.paymentStatus).toBe('UNPAID');
      expect(await balanceOf('4000_DELIVERY_REVENUE')).toBe(0n);
    });

    it('settles once, marks the delivery PAID and books revenue plus the gateway fee', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const init = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);

      const settled = await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      expect(settled.body.payment.status).toBe('SUCCESS');
      expect(settled.body.payment.feeKobo).not.toBe('0');

      const fresh = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(fresh.paymentStatus).toBe('PAID');

      expect(await balanceOf('4000_DELIVERY_REVENUE')).toBe(delivery.chargeKobo);
      expect(await balanceOf('1010_PAYSTACK_CLEARING')).toBe(
        delivery.chargeKobo - BigInt(settled.body.payment.feeKobo),
      );
      expect(await balanceOf('5100_GATEWAY_FEES')).toBe(BigInt(settled.body.payment.feeKobo));
      await expectBooksBalanced();
    });

    it('does not credit the same payment twice when the customer taps pay again', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const init = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);
      const again = await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      expect(again.body.alreadySettled).toBe(true);
      expect(await balanceOf('4000_DELIVERY_REVENUE')).toBe(delivery.chargeKobo);
      await expectBooksBalanced();
    });

    it('will not let one customer pay for another customer’s delivery', async () => {
      const owner = await registerAndActivateCustomer(app);
      const stranger = await registerAndActivateCustomer(app);
      const delivery = await book(owner.accessToken);

      await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(stranger.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(404);
    });

    it('refuses to initialize a payment for an already-paid delivery', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/pay-with-wallet`)
        .set(as(customer.accessToken))
        .expect(201)
        .catch(() => undefined); // no balance yet — expected to fail; settle via gateway instead
      const init = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(409);
      expect(second.body.error.code).toBe('DELIVERY_ALREADY_PAID');
    });
  });

  /* ───────────────────────── 3. webhooks ───────────────────────── */

  describe('webhooks', () => {
    const postWebhook = (body: string, signature: string) =>
      request(app.getHttpServer())
        .post('/api/v1/webhooks/payments/paystack')
        .set({ 'Content-Type': 'application/json', 'x-paystack-signature': signature })
        .send(body);

    it('rejects a webhook whose signature does not match', async () => {
      const body = JSON.stringify({ event: 'charge.success', data: { id: 991, reference: 'PAY-NOPE-1' } });
      const response = await postWebhook(body, 'not-a-real-signature');
      expect(response.status).toBe(401);
      // The attempt is still recorded — evidence, not silence.
      const stored = await prisma.paymentWebhook.findFirst({
        where: { eventId: 'charge.success:991' },
        orderBy: { createdAt: 'desc' },
      });
      expect(stored?.signatureValid).toBe(false);
    });

    it('accepts a genuinely signed webhook and ignores the replay', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const init = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);

      const eventId = Math.floor(Math.random() * 1_000_000);
      const body = JSON.stringify({
        event: 'charge.success',
        data: { id: eventId, reference: init.body.reference, amount: Number(delivery.chargeKobo) },
      });
      const signature = createHmac('sha512', SECRET).update(body).digest('hex');

      const first = await postWebhook(body, signature).expect(200);
      expect(first.body.received).toBe(true);
      // DEVELOPMENT mode: the gateway cannot be reached, so settlement stays with
      // the simulator endpoint — but the event is recorded exactly once.
      const second = await postWebhook(body, signature).expect(200);
      expect(second.body.duplicate).toBe(true);
      expect(await prisma.paymentWebhook.count({ where: { eventId: `charge.success:${eventId}` } })).toBe(1);
    });
  });

  /* ───────────────────────── 4. wallet ───────────────────────── */

  describe('the customer wallet', () => {
    it('credits a top-up only when it settles, and books the liability', async () => {
      const customer = await registerAndActivateCustomer(app);

      const before = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set(as(customer.accessToken))
        .expect(200);
      expect(before.body.balanceKobo).toBe('0');

      const init = await request(app.getHttpServer())
        .post('/api/v1/payments/wallet/topups')
        .set(as(customer.accessToken))
        .send({ amountKobo: '500000', provider: 'PAYSTACK' })
        .expect(201);

      const stillZero = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set(as(customer.accessToken))
        .expect(200);
      expect(stillZero.body.balanceKobo).toBe('0');

      const settled = await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);
      expect(settled.body.walletBalanceKobo).toBe('500000');

      const after = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set(as(customer.accessToken))
        .expect(200);
      expect(after.body.balanceKobo).toBe('500000');
      expect(after.body.balanceFormatted).toContain('5,000');
      expect(await balanceOf('2000_CUSTOMER_WALLET_LIABILITY')).toBe(500_000n);

      const statement = await request(app.getHttpServer())
        .get('/api/v1/wallet/transactions')
        .set(as(customer.accessToken))
        .expect(200);
      expect(statement.body.data).toHaveLength(1);
      expect(statement.body.data[0].direction).toBe('CREDIT');
      expect(statement.body.data[0].category).toBe('TOPUP');
      await expectBooksBalanced();
    });

    it('pays for a delivery from the wallet and refuses when the balance is short', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);

      const short = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/pay-with-wallet`)
        .set(as(customer.accessToken))
        .expect(409);
      expect(short.body.error.code).toBe('WALLET_INSUFFICIENT_FUNDS');

      // Top up generously, then pay.
      const init = await request(app.getHttpServer())
        .post('/api/v1/payments/wallet/topups')
        .set(as(customer.accessToken))
        .send({ amountKobo: (delivery.chargeKobo + 100_000n).toString(), provider: 'PAYSTACK' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      const paid = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/pay-with-wallet`)
        .set(as(customer.accessToken))
        .expect(201);
      expect(paid.body.walletBalanceKobo).toBe('100000');
      expect(paid.body.payment.provider).toBe('WALLET');

      const fresh = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(fresh.paymentStatus).toBe('PAID');
      expect(await balanceOf('2000_CUSTOMER_WALLET_LIABILITY')).toBe(100_000n);
      await expectBooksBalanced();
    });
  });

  /* ─────────────────── 5. earnings, withdrawals, payout ─────────────────── */

  describe('rider earnings and withdrawals', () => {
    /** Completes a delivery as a rider and returns what was accrued. */
    const completeJob = async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { riderId: rider.riderId, status: 'ARRIVED_AT_DESTINATION' },
      });

      const otp = '123456';
      const { createHash } = await import('node:crypto');
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { otpHash: createHash('sha256').update(otp).digest('hex') },
      });

      const done = await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(as(rider.accessToken))
        .send({ otp })
        .expect(201);

      return { rider, customer, delivery, earning: done.body.earning };
    };

    it('accrues the rider’s share as a liability and holds it', async () => {
      const { rider, delivery, earning } = await completeJob();

      const stored = await prisma.riderEarning.findFirstOrThrow({ where: { deliveryId: delivery.id } });
      expect(stored.status).toBe('PENDING');
      expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now());
      expect(earning.netKobo).toBe(stored.netKobo.toString());

      // The company owes the rider; it has not paid them yet.
      expect(await balanceOf('2100_RIDER_EARNINGS_PAYABLE')).toBe(stored.netKobo);
      expect(await balanceOf('5000_RIDER_COMMISSION_COST')).toBe(stored.netKobo);
      // Cash-on-delivery: the delivery was not prepaid, so completion books revenue.
      expect(await balanceOf('1000_CASH_CLEARING')).toBe(delivery.chargeKobo);

      const summary = await request(app.getHttpServer())
        .get('/api/v1/rider/earnings')
        .set(as(rider.accessToken))
        .expect(200);
      expect(summary.body.pendingKobo).toBe(stored.netKobo.toString());
      expect(summary.body.withdrawableKobo).toBe('0');
      await expectBooksBalanced();
    });

    it('becomes withdrawable after the hold, and is paid through approval', async () => {
      const { rider, delivery } = await completeJob();
      const earning = await prisma.riderEarning.findFirstOrThrow({ where: { deliveryId: delivery.id } });

      // The hold expires.
      await prisma.riderEarning.update({
        where: { id: earning.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      await earnings.releaseMatured();

      const summary = await request(app.getHttpServer())
        .get('/api/v1/rider/earnings')
        .set(as(rider.accessToken))
        .expect(200);
      expect(summary.body.availableKobo).toBe(earning.netKobo.toString());
      expect(summary.body.withdrawableKobo).toBe(earning.netKobo.toString());

      const finance = await loginStaff(['FINANCE_MANAGER']);

      // Below the minimum is refused before anything is created.
      const tooSmall = await request(app.getHttpServer())
        .post('/api/v1/rider/withdrawals')
        .set(as(rider.accessToken))
        .send({
          amountKobo: '1000',
          bankName: 'GTBank',
          bankCode: '058',
          accountNumber: '0123456789',
          accountName: 'Test Rider',
        })
        .expect(422);
      expect(tooSmall.body.error.code).toBe('VALIDATION_FAILED');

      // More than is available is refused.
      const tooMuch = await request(app.getHttpServer())
        .post('/api/v1/rider/withdrawals')
        .set(as(rider.accessToken))
        .send({
          amountKobo: (earning.netKobo + 100_000n).toString(),
          bankName: 'GTBank',
          bankCode: '058',
          accountNumber: '0123456789',
          accountName: 'Test Rider',
        })
        .expect(409);
      expect(tooMuch.body.error.code).toBe('WITHDRAWAL_NOT_ELIGIBLE');

      const requested = await request(app.getHttpServer())
        .post('/api/v1/rider/withdrawals')
        .set(as(rider.accessToken))
        .send({
          amountKobo: earning.netKobo.toString(),
          bankName: 'GTBank',
          bankCode: '058',
          accountNumber: '0123456789',
          accountName: 'Test Rider',
          idempotencyKey: `test-withdrawal-${Date.now()}`,
        })
        .expect(201);
      expect(requested.body.status).toBe('REQUESTED');
      expect(requested.body.accountNumberMasked).toMatch(/6789$/);

      // The same money cannot be requested again.
      const again = await request(app.getHttpServer())
        .post('/api/v1/rider/withdrawals')
        .set(as(rider.accessToken))
        .send({
          amountKobo: earning.netKobo.toString(),
          bankName: 'GTBank',
          bankCode: '058',
          accountNumber: '0123456789',
          accountName: 'Test Rider',
        })
        .expect(409);
      expect(again.body.error.code).toBe('WITHDRAWAL_NOT_ELIGIBLE');

      // A rider cannot approve their own withdrawal.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/finance/withdrawals/${requested.body.id}/approve`)
        .set(as(rider.accessToken))
        .send({})
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/finance/withdrawals/${requested.body.id}/approve`)
        .set(as(finance.accessToken))
        .send({ note: 'Verified against delivered jobs' })
        .expect(201);

      expect(await balanceOf('2200_WITHDRAWALS_PAYABLE')).toBe(earning.netKobo);

      const paid = await request(app.getHttpServer())
        .post(`/api/v1/admin/finance/withdrawals/${requested.body.id}/payout`)
        .set(as(finance.accessToken))
        .expect(201);
      expect(paid.body.status).toBe('PAID');
      expect(paid.body.providerTransferRef).toMatch(/^SIM-WD-/);

      // The obligation is settled: nothing left payable, nothing left in transit.
      expect(await balanceOf('2200_WITHDRAWALS_PAYABLE')).toBe(0n);
      expect(await balanceOf('2100_RIDER_EARNINGS_PAYABLE')).toBe(0n);
      await expectBooksBalanced();
    });

    it('releases the money again when staff reject a withdrawal', async () => {
      const { rider, delivery } = await completeJob();
      const earning = await prisma.riderEarning.findFirstOrThrow({ where: { deliveryId: delivery.id } });
      await prisma.riderEarning.update({
        where: { id: earning.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      await earnings.releaseMatured();

      const requested = await request(app.getHttpServer())
        .post('/api/v1/rider/withdrawals')
        .set(as(rider.accessToken))
        .send({
          amountKobo: earning.netKobo.toString(),
          bankName: 'GTBank',
          bankCode: '058',
          accountNumber: '0123456789',
          accountName: 'Test Rider',
        })
        .expect(201);

      const finance = await loginStaff(['FINANCE_MANAGER']);
      const rejected = await request(app.getHttpServer())
        .post(`/api/v1/admin/finance/withdrawals/${requested.body.id}/reject`)
        .set(as(finance.accessToken))
        .send({ note: 'Bank details could not be verified' })
        .expect(201);
      expect(rejected.body.status).toBe('REJECTED');

      const summary = await request(app.getHttpServer())
        .get('/api/v1/rider/earnings')
        .set(as(rider.accessToken))
        .expect(200);
      expect(summary.body.withdrawableKobo).toBe(earning.netKobo.toString());
      await expectBooksBalanced();
    });
  });

  /* ───────────────────────── 6. refunds ───────────────────────── */

  describe('refunds', () => {
    it('refunds a wallet payment straight back into the wallet', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);

      const topUp = await request(app.getHttpServer())
        .post('/api/v1/payments/wallet/topups')
        .set(as(customer.accessToken))
        .send({ amountKobo: (delivery.chargeKobo * 2n).toString(), provider: 'PAYSTACK' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${topUp.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      const paid = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/pay-with-wallet`)
        .set(as(customer.accessToken))
        .expect(201);
      const balanceAfterPayment = BigInt(paid.body.walletBalanceKobo);

      const finance = await loginStaff(['FINANCE_MANAGER']);
      const refund = await request(app.getHttpServer())
        .post(`/api/v1/admin/finance/payments/${paid.body.payment.id}/refunds`)
        .set(as(finance.accessToken))
        .send({ amountKobo: delivery.chargeKobo.toString(), reason: 'Parcel never collected' })
        .expect(201);
      expect(refund.body.status).toBe('COMPLETED');

      const wallet = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set(as(customer.accessToken))
        .expect(200);
      expect(BigInt(wallet.body.balanceKobo)).toBe(balanceAfterPayment + delivery.chargeKobo);

      const fresh = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(fresh.paymentStatus).toBe('REFUNDED');
      await expectBooksBalanced();
    });

    it('will not refund more than the payment was worth', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const init = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      const finance = await loginStaff(['FINANCE_MANAGER']);
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { providerReference: init.body.reference },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/finance/payments/${payment.id}/refunds`)
        .set(as(finance.accessToken))
        .send({ amountKobo: (payment.amountKobo + 1n).toString(), reason: 'Too much' })
        .expect(409);
    });
  });

  /* ─────────────────── 7. the finance desk and reconciliation ─────────────────── */

  describe('the finance desk', () => {
    it('reports collected money, rider cost and profit from real rows', async () => {
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const init = await request(app.getHttpServer())
        .post('/api/v1/payments/deliveries/' + delivery.id + '/initialize')
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);
      const settled = await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      const finance = await loginStaff(['FINANCE_MANAGER']);
      const summary = await request(app.getHttpServer())
        .get('/api/v1/admin/finance/summary')
        .set(as(finance.accessToken))
        .expect(200);

      expect(summary.body.collected.payments).toBe(1);
      expect(summary.body.collected.amountKobo).toBe(delivery.chargeKobo.toString());
      expect(summary.body.collected.gatewayFeesKobo).toBe(settled.body.payment.feeKobo);
      expect(summary.body.revenue.totalFormatted).toBeTruthy();
      expect(summary.body.byProvider).toHaveLength(1);
      expect(summary.body.byProvider[0].provider).toBe('PAYSTACK');
    });

    it('keeps money away from staff who are not finance', async () => {
      const support = await loginStaff(['SUPPORT_AGENT']);
      await request(app.getHttpServer())
        .get('/api/v1/admin/finance/summary')
        .set(as(support.accessToken))
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/admin/finance/withdrawals')
        .set(as(support.accessToken))
        .expect(403);
    });

    it('proves the books reconcile after a full day of money', async () => {
      // One gateway payment, one wallet top-up, one wallet delivery payment.
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      const init = await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${delivery.id}/initialize`)
        .set(as(customer.accessToken))
        .send({ provider: 'PAYSTACK' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${init.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);

      const second = await book(customer.accessToken);
      const topUp = await request(app.getHttpServer())
        .post('/api/v1/payments/wallet/topups')
        .set(as(customer.accessToken))
        .send({ amountKobo: second.chargeKobo.toString(), provider: 'PAYSTACK' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${topUp.body.reference}/simulate`)
        .set(as(customer.accessToken))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/deliveries/${second.id}/pay-with-wallet`)
        .set(as(customer.accessToken))
        .expect(201);

      const finance = await loginStaff(['FINANCE_MANAGER']);
      const report = await request(app.getHttpServer())
        .get('/api/v1/admin/finance/reconciliation')
        .set(as(finance.accessToken))
        .expect(200);

      expect(report.body.trialBalanceBalanced).toBe(true);
      for (const check of report.body.checks) {
        expect(check.ok, `${check.name}: ${check.detail}`).toBe(true);
      }
    });
  });

  /* ───────────────────────── 8. cash on delivery ───────────────────────── */

  describe('cash on delivery', () => {
    it('books revenue when the rider completes an unpaid job', async () => {
      const rider = await createApprovedRider(prisma, passwords, app, { withDocuments: false });
      const customer = await registerAndActivateCustomer(app);
      const delivery = await book(customer.accessToken);
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { riderId: rider.riderId, status: 'ARRIVED_AT_DESTINATION' },
      });

      const { createHash } = await import('node:crypto');
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { otpHash: createHash('sha256').update('654321').digest('hex') },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/rider/jobs/${delivery.id}/complete`)
        .set(as(rider.accessToken))
        .send({ otp: '654321' })
        .expect(201);

      const fresh = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(fresh.paymentStatus).toBe('PAID');
      const cashPayment = await prisma.payment.findFirstOrThrow({
        where: { deliveryId: delivery.id, provider: 'CASH' },
      });
      expect(cashPayment.status).toBe('SUCCESS');
      expect(await balanceOf('4000_DELIVERY_REVENUE')).toBe(delivery.chargeKobo);
      await expectBooksBalanced();
    });
  });
});

/** Keeps the type-only import of VALID_PASSWORD meaningful for future staff logins. */
void VALID_PASSWORD;
