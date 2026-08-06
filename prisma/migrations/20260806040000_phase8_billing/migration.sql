
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "ratesAt" TIMESTAMP(3),
ADD COLUMN     "ratesSnapshot" JSONB,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedByUserId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "bisCertNo" TEXT,
ADD COLUMN     "hallmarkNo" TEXT;

-- CreateTable
CREATE TABLE "BillSequence" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BillSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "BillPdf" (
    "key" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillPdf_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillPdf_orderId_key" ON "BillPdf"("orderId");

-- CreateIndex
CREATE INDEX "BillPdf_expiresAt_idx" ON "BillPdf"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- AddForeignKey
ALTER TABLE "BillPdf" ADD CONSTRAINT "BillPdf_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

