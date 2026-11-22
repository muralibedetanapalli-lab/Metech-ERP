-- AlterTable
ALTER TABLE "CostCentre" ADD COLUMN     "apiKeyEnc" TEXT,
ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "baseUrl" TEXT,
ADD COLUMN     "connector" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "syncEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "costCentreId" TEXT;

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "SyncEvent" (
    "projectId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("projectId","eventId")
);

-- CreateIndex
CREATE INDEX "Invoice_costCentreId_idx" ON "Invoice"("costCentreId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "CostCentre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CostCentre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: Dukaan Express becomes a project (connector DUKAAN). Reuse a cost centre already coded DUKAAN.
INSERT INTO "CostCentre" ("id", "code", "name", "kind", "description", "connector", "syncEnabled", "active", "createdAt")
VALUES ('proj_dukaan', 'DUKAAN', 'Dukaan Express', 'PROJECT', 'Hyperlocal marketplace: commission and delivery margin', 'DUKAAN', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "connector" = 'DUKAAN', "kind" = 'PROJECT', "syncEnabled" = true;

-- Tag every line of past Dukaan postings with the Dukaan project (only untagged lines).
UPDATE "JournalLine" jl SET "costCentreId" = (SELECT "id" FROM "CostCentre" WHERE "code" = 'DUKAAN')
FROM "JournalEntry" je
WHERE jl."entryId" = je."id" AND je."source" = 'DUKAAN' AND jl."costCentreId" IS NULL;

-- Past sync runs were all Dukaan runs.
UPDATE "SyncRun" SET "projectId" = (SELECT "id" FROM "CostCentre" WHERE "code" = 'DUKAAN') WHERE "projectId" IS NULL;

-- Invoices carry their project; take it from the journal lines they posted.
UPDATE "Invoice" i SET "costCentreId" = sub."costCentreId"
FROM (SELECT DISTINCT ON (jl."entryId") jl."entryId", jl."costCentreId" FROM "JournalLine" jl WHERE jl."costCentreId" IS NOT NULL ORDER BY jl."entryId", jl."id") sub
WHERE sub."entryId" = i."journalEntryId" AND i."costCentreId" IS NULL;
