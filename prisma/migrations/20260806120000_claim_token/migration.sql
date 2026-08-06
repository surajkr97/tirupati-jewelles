
-- CreateTable
CREATE TABLE "ClaimToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "orderId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimToken_tokenHash_key" ON "ClaimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ClaimToken_phone_idx" ON "ClaimToken"("phone");

-- CreateIndex
CREATE INDEX "ClaimToken_expiresAt_idx" ON "ClaimToken"("expiresAt");

