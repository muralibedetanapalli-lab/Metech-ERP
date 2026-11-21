-- CreateEnum
CREATE TYPE "InvoiceDocType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "docType" "InvoiceDocType" NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "noteReason" TEXT,
ADD COLUMN     "originalInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_originalInvoiceId_idx" ON "Invoice"("originalInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
