-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "dispatchRound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastRoundAt" TIMESTAMP(3);
