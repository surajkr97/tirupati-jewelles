-- DropIndex
DROP INDEX "Product_name_trgm_idx";

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "shopName" TEXT NOT NULL DEFAULT 'Tirupati Jewelles',
    "address" TEXT,
    "gstin" TEXT,
    "contact_phone" TEXT,
    "owner_whatsapp" TEXT,
    "defaultGstPct" DECIMAL(5,2) NOT NULL DEFAULT 3.00,
    "defaultMakingPct" DECIMAL(5,2) NOT NULL DEFAULT 12.00,
    "billPrefix" TEXT NOT NULL DEFAULT 'JW',
    "billSequence" INTEGER NOT NULL DEFAULT 1,
    "tickerJitter" BOOLEAN,
    "businessHours" TEXT,
    "holidayNotice" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);
