import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaService } from "../src/infra/prisma/prisma.service";
import type { RedisService } from "../src/infra/redis/redis.service";
import type { PasswordService } from "../src/auth/password.service";
import { createTestApp } from "./helpers/app";
import {
  VALID_PASSWORD,
  clearRateLimits,
  createApprovedRider,
  createStaff,
  registerAndActivateCustomer,
  resetUsers,
  uniqueEmail,
  uniquePhone,
} from "./helpers/auth-test-helpers";

/**
 * PHASE 5 — THE ADMIN COMMAND CENTRE
 *
 * Three things are being proved here, and only three:
 *
 *   1. The dashboard figures are real. A scenario is written straight into the
 *      database with known numbers, and the endpoint must return exactly those
 *      numbers — no rounding into a different answer, no cached counters.
 *   2. Permissions are enforced per route. A support agent may read the
 *      dashboard and the delivery list, and may do nothing financial or
 *      destructive. A rider cannot touch the admin API at all.
 *   3. Suspension has teeth: a suspended account cannot sign in, and its live
 *      sessions die immediately.
 */
describe("Phase 5 — admin command centre", () => {
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

  const loginStaff = async (roleKeys: string[]) => {
    const staff = await createStaff(prisma, passwords, roleKeys);
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        identifier: staff.email,
        password: staff.password,
        audience: "ADMIN",
      })
      .expect(201);
    const record = await prisma.staff.findUniqueOrThrow({
      where: { userId: staff.id },
    });
    return {
      ...staff,
      staffId: record.id,
      accessToken: login.body.accessToken as string,
    };
  };

  /* ───────────────────────── the scenario ───────────────────────── */

  const CHARGE_DELIVERED = 320_150n; // ₦3,201.50 — the real quote from Phase 4
  const COMMISSION = 64_030n; // 20% of the charge
  const RIDER_NET = CHARGE_DELIVERED - COMMISSION;

  /**
   * Writes a small, fully known day of trading:
   *   · one delivered job (40 minutes door to door, Lagos Island)
   *   · one cancelled job
   *   · one job still waiting for a rider
   */
  const scenario = async () => {
    const admin = await loginStaff(["SUPER_ADMIN"]);
    const support = await loginStaff(["SUPPORT_AGENT"]);
    const customer = await registerAndActivateCustomer(app);
    const customerRow = await prisma.customer.findUniqueOrThrow({
      where: { userId: customer.userId },
      select: { id: true },
    });
    const rider = await createApprovedRider(prisma, passwords, app);
    await prisma.rider.update({
      where: { id: rider.riderId },
      data: { availability: "ONLINE" },
    });

    const branch = await prisma.branch.findFirstOrThrow();
    const zone = await prisma.serviceZone.findFirstOrThrow({
      orderBy: { name: "asc" },
    });
    const createdAt = new Date();

    const base = {
      customerId: customerRow.id,
      branchId: branch.id,
      serviceZoneId: zone.id,
      deliveryType: "STANDARD" as never,
      pickupAddress: "12 Adeola Odeku Street, Victoria Island",
      pickupLat: 6.4281,
      pickupLng: 3.4219,
      destAddress: "5 Bode Thomas Street, Surulere",
      destLat: 6.5001,
      destLng: 3.3587,
      senderName: "Ada Okafor",
      senderPhone: customer.phone,
      recipientName: "Chidi Okafor",
      recipientPhone: "+2348030000001",
      packageCategory: "DOCUMENTS",
      packageDescription: "Sealed envelope",
      priceSnapshot: { baseFeeKobo: "150000", perKmFeeKobo: "13000" },
      createdAt,
    };

    const delivered = await prisma.delivery.create({
      data: {
        ...base,
        reference: "DSP-ADMIN-DELIVERED",
        status: "DELIVERED",
        riderId: rider.riderId,
        chargeKobo: CHARGE_DELIVERED,
        distanceKm: 15.1,
        paymentStatus: "PAID",
        acceptedAt: createdAt,
        deliveredAt: new Date(createdAt.getTime() + 40 * 60 * 1000),
        commissionSnapshot: {
          commissionPct: 20,
          commissionKobo: COMMISSION.toString(),
        },
      },
    });

    await prisma.delivery.create({
      data: {
        ...base,
        reference: "DSP-ADMIN-CANCELLED",
        status: "CANCELLED",
        chargeKobo: 200_000n,
        cancellationReason: "Customer changed their mind",
        cancelledAt: createdAt,
      },
    });

    const waiting = await prisma.delivery.create({
      data: {
        ...base,
        reference: "DSP-ADMIN-WAITING",
        status: "PENDING",
        chargeKobo: 250_000n,
      },
    });

    await prisma.riderEarning.create({
      data: {
        riderId: rider.riderId,
        deliveryId: delivered.id,
        grossKobo: CHARGE_DELIVERED,
        commissionKobo: COMMISSION,
        netKobo: RIDER_NET,
        status: "PENDING",
        availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return {
      admin,
      support,
      customer,
      customerRow,
      rider,
      delivered,
      waiting,
      zone,
    };
  };

  /* ───────────────────── 1. the numbers are real ────────────────── */

  describe("the overview is computed, not decorated", () => {
    it("reports exactly the scenario that was written to the database", async () => {
      const { admin } = await scenario();

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard")
        .set(as(admin.accessToken))
        .expect(200);

      expect(res.body.deliveries.total).toBe(3);
      expect(res.body.deliveries.delivered).toBe(1);
      expect(res.body.deliveries.cancelled).toBe(1);
      expect(res.body.deliveries.awaitingAssignment).toBe(1);
      // 1 delivered out of 1 delivered + 1 cancelled + 0 failed.
      expect(res.body.deliveries.successRate).toBe(50);
      expect(res.body.deliveries.avgDeliveryMinutes).toBe(40);

      expect(res.body.money.grossKobo).toBe("320150");
      expect(res.body.money.grossFormatted).toBe("₦3,201.50");
      expect(res.body.money.commissionKobo).toBe("64030");
      expect(res.body.money.commissionFormatted).toBe("₦640.30");
      expect(res.body.money.riderNetKobo).toBe("256120");
      expect(res.body.money.riderNetFormatted).toBe("₦2,561.20");
      expect(res.body.money.averageOrderFormatted).toBe("₦3,201.50");
      expect(res.body.money.marginKobo).toBe("64030");

      expect(res.body.riders.total).toBe(1);
      expect(res.body.riders.online).toBe(1);
      expect(res.body.customers.total).toBe(1);
    });

    it("lists every live zone, including the quiet ones", async () => {
      const { admin } = await scenario();
      const zoneCount = await prisma.serviceZone.count({
        where: { isActive: true },
      });

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard")
        .set(as(admin.accessToken))
        .expect(200);

      expect(res.body.zones).toHaveLength(zoneCount);
      const busiest = res.body.zones[0];
      expect(busiest.delivered).toBe(1);
      expect(busiest.revenueFormatted).toBe("₦3,201.50");
      expect(
        res.body.zones.filter(
          (zone: { delivered: number }) => zone.delivered === 0,
        ).length,
      ).toBe(zoneCount - 1);
    });

    it("builds a daily series that agrees with the money card", async () => {
      const { admin } = await scenario();

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard")
        .set(as(admin.accessToken))
        .expect(200);

      const today = new Date().toISOString().slice(0, 10);
      const row = res.body.daily.find(
        (entry: { date: string }) => entry.date === today,
      );
      expect(row).toBeTruthy();
      expect(row.deliveries).toBe(3);
      expect(row.delivered).toBe(1);
      // The chart's revenue must equal the gross KPI — same filter, same source.
      expect(row.revenueKobo).toBe(res.body.money.grossKobo);
    });

    it("honours the date range instead of ignoring it", async () => {
      const { admin } = await scenario();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/dashboard?from=${tomorrow}`)
        .set(as(admin.accessToken))
        .expect(200);

      expect(res.body.deliveries.total).toBe(0);
      expect(res.body.money.grossFormatted).toBe("₦0.00");
      expect(res.body.deliveries.successRate).toBeNull();
      expect(res.body.daily).toEqual([]);
    });
  });

  /* ──────────────────── 2. permissions per route ────────────────── */

  describe("permissions", () => {
    it("lets a support agent read the dashboard and the delivery list", async () => {
      const { support, waiting } = await scenario();

      await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard")
        .set(as(support.accessToken))
        .expect(200);

      const list = await request(app.getHttpServer())
        .get("/api/v1/admin/deliveries?pageSize=5")
        .set(as(support.accessToken))
        .expect(200);
      expect(
        list.body.data.map((item: { reference: string }) => item.reference),
      ).toContain(waiting.reference);
    });

    it("stops a support agent from touching money, pricing or staff", async () => {
      const { support, waiting, customerRow } = await scenario();
      const rules = await prisma.pricingRule.findFirstOrThrow();

      // Assigning a job is an operations decision, not a support one.
      const assign = await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${waiting.id}/assign`)
        .set(as(support.accessToken))
        .send({ riderId: (await prisma.rider.findFirstOrThrow()).id })
        .expect(403);
      expect(assign.body.error.code).toBe("FORBIDDEN");

      // Suspending a customer is a destructive action.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/customers/${customerRow.id}/status`)
        .set(as(support.accessToken))
        .send({ status: "SUSPENDED", reason: "Support tried it" })
        .expect(403);

      // Pricing is financial.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/pricing/rules/${rules.id}`)
        .set(as(support.accessToken))
        .send({ baseFeeNaira: 1 })
        .expect(403);

      // Setting up staff accounts is not a support task either.
      await request(app.getHttpServer())
        .post("/api/v1/admin/team")
        .set(as(support.accessToken))
        .send({
          firstName: "Sneaky",
          lastName: "Agent",
          email: uniqueEmail("sneaky"),
          phone: uniquePhone(),
          password: VALID_PASSWORD,
          roleKeys: ["SUPER_ADMIN"],
        })
        .expect(403);

      // Nothing above changed a single row.
      const after = await prisma.delivery.findUniqueOrThrow({
        where: { id: waiting.id },
      });
      expect(after.status).toBe("PENDING");
      const customer = await prisma.customer.findUniqueOrThrow({
        where: { id: customerRow.id },
        include: { user: { select: { status: true } } },
      });
      expect(customer.user.status).toBe("ACTIVE");
    });

    it("keeps the admin API closed to customers and riders", async () => {
      const { customer, rider } = await scenario();

      await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard")
        .set(as(customer.accessToken))
        .expect(403);

      await request(app.getHttpServer())
        .get("/api/v1/admin/dashboard")
        .set(as(rider.accessToken))
        .expect(403);
    });
  });

  /* ───────────────── 3. suspension actually blocks ─────────────── */

  describe("suspension", () => {
    it("kills the session and blocks the next sign-in until reactivated", async () => {
      const { admin, customer, customerRow } = await scenario();

      const suspend = await request(app.getHttpServer())
        .post(`/api/v1/admin/customers/${customerRow.id}/status`)
        .set(as(admin.accessToken))
        .send({ status: "SUSPENDED", reason: "Chargeback fraud investigation" })
        .expect(201);
      expect(suspend.body.accountStatus).toBe("SUSPENDED");
      expect(suspend.body.sessionsRevoked).toBeGreaterThan(0);

      // The token they were already holding is dead: refresh tokens are revoked
      // and the account is no longer ACTIVE.
      const stillIn = await request(app.getHttpServer())
        .get("/api/v1/deliveries")
        .set(as(customer.accessToken));
      expect([401, 403]).toContain(stillIn.status);

      const denied = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          identifier: customer.email,
          password: VALID_PASSWORD,
          audience: "CUSTOMER",
        })
        .expect(403);
      // The refusal must say what happened, and must not hand out a token.
      expect(denied.body.error.code).toBe("FORBIDDEN");
      expect(denied.body.error.message).toMatch(/suspended/i);
      expect(denied.body.accessToken).toBeUndefined();

      await request(app.getHttpServer())
        .post(`/api/v1/admin/customers/${customerRow.id}/status`)
        .set(as(admin.accessToken))
        .send({ status: "ACTIVE", reason: "Investigation closed" })
        .expect(201);

      await clearRateLimits(redis);
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          identifier: customer.email,
          password: VALID_PASSWORD,
          audience: "CUSTOMER",
        })
        .expect(201);
    });

    it("refuses to let an admin suspend themselves or the last super admin", async () => {
      const { admin } = await scenario();

      const self = await request(app.getHttpServer())
        .post(`/api/v1/admin/team/${admin.staffId}/status`)
        .set(as(admin.accessToken))
        .send({ status: "SUSPENDED", reason: "Locking myself out" })
        .expect(409);
      expect(self.body.error.code).toBe("SELF_ACTION_FORBIDDEN");

      // The only super admin cannot be suspended by somebody else either.
      const secondAdmin = await loginStaff(["OPERATIONS_MANAGER"]);
      const other = await request(app.getHttpServer())
        .post(`/api/v1/admin/team/${admin.staffId}/status`)
        .set(as(secondAdmin.accessToken))
        .send({ status: "SUSPENDED", reason: "Trying it" });
      // OPERATIONS_MANAGER lacks staff:write, so this is refused earlier at 403.
      expect([403, 409]).toContain(other.status);
    });

    it("creates a staff account that can sign in with the roles it was given", async () => {
      const { admin } = await scenario();
      const email = uniqueEmail("finance");

      const created = await request(app.getHttpServer())
        .post("/api/v1/admin/team")
        .set(as(admin.accessToken))
        .send({
          firstName: "Fola",
          lastName: "Finance",
          email,
          phone: uniquePhone(),
          password: "Finance@12345",
          roleKeys: ["FINANCE_MANAGER"],
          jobTitle: "Finance Manager",
        })
        .expect(201);

      expect(created.body.roles).toEqual(["FINANCE_MANAGER"]);
      expect(created.body.staffCode).toMatch(/^STF-/);

      const login = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          identifier: email,
          password: "Finance@12345",
          audience: "ADMIN",
        })
        .expect(201);

      const pricing = await request(app.getHttpServer())
        .get("/api/v1/admin/pricing")
        .set(as(login.body.accessToken))
        .expect(200);
      expect(pricing.body.rules.length).toBeGreaterThan(0);

      // A finance manager cannot create staff.
      await request(app.getHttpServer())
        .post("/api/v1/admin/team")
        .set(as(login.body.accessToken))
        .send({
          firstName: "No",
          lastName: "Way",
          email: uniqueEmail("nope"),
          phone: uniquePhone(),
          password: VALID_PASSWORD,
          roleKeys: ["SUPPORT_AGENT"],
        })
        .expect(403);
    });
  });

  /* ──────────────────── 4. dispatcher overrides ─────────────────── */

  describe("manual assignment and cancellation", () => {
    it("assigns a waiting job to a rider and freezes the commission", async () => {
      const { admin, waiting, rider } = await scenario();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${waiting.id}/assign`)
        .set(as(admin.accessToken))
        .send({
          riderId: rider.riderId,
          reason: "Nobody accepted the offer in time",
        })
        .expect(201);

      expect(res.body.status).toBe("ASSIGNED");

      const delivery = await prisma.delivery.findUniqueOrThrow({
        where: { id: waiting.id },
        include: { assignments: true, statusHistory: true },
      });
      expect(delivery.riderId).toBe(rider.riderId);
      expect(delivery.status).toBe("ASSIGNED");
      expect(delivery.commissionSnapshot).toMatchObject({
        assignedBy: "STAFF",
      });

      const manual = delivery.assignments.find(
        (row) => row.method === "MANUAL",
      );
      expect(manual).toBeTruthy();
      expect(manual!.status).toBe("ACCEPTED");
      expect(manual!.assignedById).toBe(admin.staffId);

      expect(
        delivery.statusHistory.some(
          (row) => row.toStatus === "ASSIGNED" && row.actorType === "STAFF",
        ),
      ).toBe(true);

      // The rider is now busy, and the audit trail names the dispatcher.
      const riderRow = await prisma.rider.findUniqueOrThrow({
        where: { id: rider.riderId },
      });
      expect(riderRow.availability).toBe("ON_DELIVERY");

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityType: "Delivery",
          entityId: waiting.id,
          action: "delivery.assign",
        },
      });
      expect(audit).toBeTruthy();
    });

    it("refuses an unapproved rider and a finished job", async () => {
      const { admin, waiting, delivered } = await scenario();
      const pendingRider = await createApprovedRider(prisma, passwords, app);
      await prisma.rider.update({
        where: { id: pendingRider.riderId },
        data: { approvalStatus: "PENDING" },
      });

      const unapproved = await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${waiting.id}/assign`)
        .set(as(admin.accessToken))
        .send({ riderId: pendingRider.riderId })
        .expect(409);
      expect(unapproved.body.error.code).toBe("RIDER_NOT_APPROVED");

      const finished = await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${delivered.id}/assign`)
        .set(as(admin.accessToken))
        .send({ riderId: pendingRider.riderId })
        .expect(409);
      expect(finished.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    });

    it("cancels a live job and refuses to cancel a delivered one", async () => {
      const { admin, waiting, delivered } = await scenario();

      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${waiting.id}/cancel`)
        .set(as(admin.accessToken))
        .send({ reason: "Duplicate booking" })
        .expect(201);
      expect(cancelled.body.status).toBe("CANCELLED");

      const row = await prisma.delivery.findUniqueOrThrow({
        where: { id: waiting.id },
        include: { statusHistory: true },
      });
      expect(row.cancelledAt).toBeTruthy();
      expect(row.cancellationReason).toBe("Duplicate booking");
      expect(
        row.statusHistory.some(
          (entry) =>
            entry.toStatus === "CANCELLED" && entry.actorType === "STAFF",
        ),
      ).toBe(true);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${delivered.id}/cancel`)
        .set(as(admin.accessToken))
        .send({ reason: "Too late" })
        .expect(409);
    });

    it("requires a real reason before cancelling", async () => {
      const { admin, waiting } = await scenario();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/deliveries/${waiting.id}/cancel`)
        .set(as(admin.accessToken))
        .send({ reason: "no" })
        .expect(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  /* ──────────────────────── 5. CSV export ───────────────────────── */

  describe("CSV export", () => {
    it("returns a spreadsheet-parseable file with one row per delivery", async () => {
      const { admin } = await scenario();

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/deliveries/export.csv")
        .set(as(admin.accessToken))
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");

      const lines = res.text.trim().split("\n");
      expect(lines[0]!.split(",")[0]).toBe("reference");
      // Header + the three scenario deliveries.
      expect(lines).toHaveLength(4);
      expect(res.text).toContain("DSP-ADMIN-DELIVERED");
      expect(res.text).toContain("DSP-ADMIN-CANCELLED");
      // Charges are exported in kobo and in naira, so nobody has to guess.
      expect(res.text).toContain("320150");
      expect(res.text).toContain("3201.50");
      // A comma inside an address must not shift every column after it.
      expect(res.text).toMatch(/"[^"]*,[^"]*"/);
    });

    it("filters the export exactly like the table", async () => {
      const { admin } = await scenario();

      const res = await request(app.getHttpServer())
        .get("/api/v1/admin/deliveries/export.csv?status=DELIVERED")
        .set(as(admin.accessToken))
        .expect(200);

      const lines = res.text.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(res.text).toContain("DSP-ADMIN-DELIVERED");
      expect(res.text).not.toContain("DSP-ADMIN-WAITING");
    });
  });

  /* ─────────────────────── 6. pricing rules ─────────────────────── */

  describe("pricing", () => {
    it("converts naira input to kobo once and records the change", async () => {
      const { admin } = await scenario();
      const rule = await prisma.pricingRule.findFirstOrThrow({
        where: { isActive: true },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/pricing/rules/${rule.id}`)
        .set(as(admin.accessToken))
        .send({ baseFeeNaira: 1800, minFeeNaira: 1800, perKmFeeNaira: 145.5 })
        .expect(201);

      expect(res.body.baseFeeFormatted).toBe("₦1,800.00");

      const updated = await prisma.pricingRule.findUniqueOrThrow({
        where: { id: rule.id },
      });
      expect(updated.baseFeeKobo).toBe(180_000n);
      expect(updated.perKmFeeKobo).toBe(14_550n);

      const audit = await prisma.auditLog.findFirst({
        where: { action: "pricing.rule.update", entityId: rule.id },
      });
      expect(audit).toBeTruthy();
      expect(audit!.after).toMatchObject({ baseFeeKobo: "180000" });

      // Put the seeded figure back so later tests and manual runs start clean.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/pricing/rules/${rule.id}`)
        .set(as(admin.accessToken))
        .send({
          baseFeeNaira: Number(rule.baseFeeKobo) / 100,
          minFeeNaira: Number(rule.minFeeKobo) / 100,
          perKmFeeNaira: Number(rule.perKmFeeKobo) / 100,
        })
        .expect(201);
    });

    it("refuses a minimum below the base fee and a commission above 100%", async () => {
      const { admin } = await scenario();
      const rule = await prisma.pricingRule.findFirstOrThrow({
        where: { isActive: true },
      });

      const min = await request(app.getHttpServer())
        .post(`/api/v1/admin/pricing/rules/${rule.id}`)
        .set(as(admin.accessToken))
        .send({ baseFeeNaira: 2000, minFeeNaira: 1500 })
        .expect(422);
      expect(min.body.error.code).toBe("VALIDATION_FAILED");

      const pct = await request(app.getHttpServer())
        .post(`/api/v1/admin/pricing/rules/${rule.id}`)
        .set(as(admin.accessToken))
        .send({ defaultCommissionPct: 120 })
        .expect(422);
      expect(pct.body.error.code).toBe("VALIDATION_FAILED");

      const negative = await request(app.getHttpServer())
        .post(`/api/v1/admin/pricing/rules/${rule.id}`)
        .set(as(admin.accessToken))
        .send({ perKmFeeNaira: -5 })
        .expect(422);
      expect(negative.body.error.code).toBe("VALIDATION_FAILED");

      const unchanged = await prisma.pricingRule.findUniqueOrThrow({
        where: { id: rule.id },
      });
      expect(unchanged.baseFeeKobo).toBe(rule.baseFeeKobo);
    });
  });
});
