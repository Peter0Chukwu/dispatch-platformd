-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderUserId" UUID NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "proxyNumber" TEXT NOT NULL,
    "providerRef" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'CONSOLE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_deliveryId_createdAt_idx" ON "messages"("deliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "call_sessions_deliveryId_idx" ON "call_sessions"("deliveryId");

-- CreateIndex
CREATE INDEX "call_sessions_expiresAt_idx" ON "call_sessions"("expiresAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
