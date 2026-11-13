-- CreateTable
CREATE TABLE "staff_invites" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "roleKeys" TEXT[],
    "jobTitle" TEXT,
    "branchId" UUID,
    "invitedByUserId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "acceptedUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invites_tokenHash_key" ON "staff_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "staff_invites_email_idx" ON "staff_invites"("email");

-- CreateIndex
CREATE INDEX "staff_invites_expiresAt_idx" ON "staff_invites"("expiresAt");
