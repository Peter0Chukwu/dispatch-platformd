-- ===========================================================================
-- Database-level integrity guarantees that Prisma's schema language cannot
-- express. These are the final line of defence for money and ratings: even a
-- bug in application code cannot write a negative balance or an unbalanced
-- ledger line past PostgreSQL.
-- ===========================================================================

-- 1. A wallet can never go negative.
ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_balance_non_negative" CHECK ("balanceKobo" >= 0);

-- 2. Every ledger line is either a debit OR a credit — never both, never neither.
ALTER TABLE "ledger_lines"
  ADD CONSTRAINT "ledger_lines_one_side_only"
  CHECK (
    (CASE WHEN "debitKobo"  > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN "creditKobo" > 0 THEN 1 ELSE 0 END) = 1
  );

-- 3. Amounts on financial rows are strictly positive where they must be.
ALTER TABLE "payments"    ADD CONSTRAINT "payments_amount_positive"    CHECK ("amountKobo" > 0);
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_amount_positive" CHECK ("amountKobo" > 0);
ALTER TABLE "deliveries"  ADD CONSTRAINT "deliveries_charge_non_negative" CHECK ("chargeKobo" >= 0);
ALTER TABLE "deliveries"  ADD CONSTRAINT "deliveries_cod_non_negative"    CHECK ("codAmountKobo" >= 0);

-- 4. Ratings are 1..5.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- 5. A rider's net earning must equal the arithmetic of its parts.
ALTER TABLE "rider_earnings"
  ADD CONSTRAINT "rider_earnings_net_consistent"
  CHECK ("netKobo" = "grossKobo" - "commissionKobo" + "bonusKobo" - "penaltyKobo");

-- 6. A delivery's rider must be attached at most once to a given assignment.
--    (The unique index already covers this; this comment documents intent.)

-- 7. Useful lookups that Prisma cannot declare as partial indexes.
CREATE INDEX "deliveries_active_status_idx"
  ON "deliveries" ("status", "createdAt" DESC)
  WHERE "status" NOT IN ('DELIVERED', 'CANCELLED', 'REJECTED', 'RETURNED');

CREATE INDEX "deliveries_scheduled_pending_idx"
  ON "deliveries" ("scheduledFor")
  WHERE "status" = 'PENDING' AND "scheduledFor" IS NOT NULL;

CREATE INDEX "riders_available_dispatch_idx"
  ON "riders" ("branchId", "serviceZoneId")
  WHERE "availability" = 'ONLINE' AND "approvalStatus" = 'APPROVED';
