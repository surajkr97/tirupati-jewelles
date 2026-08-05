-- CreateTable
CREATE TABLE "CalculatorShare" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "rates" JSONB NOT NULL,
    "ratesAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalculatorShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalculatorShare_slug_key" ON "CalculatorShare"("slug");

-- CreateIndex
CREATE INDEX "CalculatorShare_expiresAt_idx" ON "CalculatorShare"("expiresAt");
