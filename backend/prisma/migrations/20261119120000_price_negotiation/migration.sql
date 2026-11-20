-- Price negotiation: the customer can accept the bill or name their own price, and
-- a rider can ask for more than either number. Every amount that mattered is stored
-- on the row it belongs to, so a deal can always be reconstructed.

-- CreateEnum
CREATE TYPE "CounterState" AS ENUM ('NONE', 'PENDING', 'DECLINED', 'ACCEPTED');

-- AlterTable: the delivery carries both numbers
ALTER TABLE "deliveries"
  ADD COLUMN "quotedKobo" BIGINT,
  ADD COLUMN "askKobo" BIGINT,
  ADD COLUMN "isNegotiated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "agreedKobo" BIGINT,
  ADD COLUMN "agreedBasis" TEXT;

-- Existing rows: the charge was always the quote, and nobody haggled.
UPDATE "deliveries" SET "quotedKobo" = "chargeKobo" WHERE "quotedKobo" IS NULL;

-- AlterTable: a rider's own price, on their own offer row
ALTER TABLE "delivery_assignments"
  ADD COLUMN "counterKobo" BIGINT,
  ADD COLUMN "counterState" "CounterState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "counteredAt" TIMESTAMP(3),
  ADD COLUMN "agreedKobo" BIGINT,
  ADD COLUMN "agreedBasis" TEXT;

-- Offers that were already accepted agreed to the price on the delivery.
UPDATE "delivery_assignments"
   SET "agreedKobo" = d."chargeKobo", "agreedBasis" = 'QUOTE'
  FROM "deliveries" d
 WHERE d."id" = "delivery_assignments"."deliveryId"
   AND "delivery_assignments"."status" = 'ACCEPTED'
   AND "delivery_assignments"."agreedKobo" IS NULL;

CREATE INDEX "delivery_assignments_deliveryId_counterState_idx"
  ON "delivery_assignments" ("deliveryId", "counterState");
