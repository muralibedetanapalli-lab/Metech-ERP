-- CreateTable
CREATE TABLE "Renewal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'DOMAIN',
    "provider" TEXT,
    "reference" TEXT,
    "vendorId" TEXT,
    "costCentreId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "renewalDate" TIMESTAMP(3) NOT NULL,
    "cycleMonths" INTEGER NOT NULL DEFAULT 12,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "gstRateBps" INTEGER NOT NULL DEFAULT 1800,
    "accountId" TEXT,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "remindDays" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Renewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalEvent" (
    "id" TEXT NOT NULL,
    "renewalId" TEXT NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "gstAmount" INTEGER NOT NULL DEFAULT 0,
    "expenseId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Renewal_status_renewalDate_idx" ON "Renewal"("status", "renewalDate");

-- CreateIndex
CREATE INDEX "RenewalEvent_renewalId_paidOn_idx" ON "RenewalEvent"("renewalId", "paidOn");

-- AddForeignKey
ALTER TABLE "Renewal" ADD CONSTRAINT "Renewal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Renewal" ADD CONSTRAINT "Renewal_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "CostCentre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalEvent" ADD CONSTRAINT "RenewalEvent_renewalId_fkey" FOREIGN KEY ("renewalId") REFERENCES "Renewal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
