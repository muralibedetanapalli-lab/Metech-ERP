import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { PageHeader } from "@/components/page";
import { todayIso } from "@/lib/dates";
import { DOC_TYPES, docLabel, type DocType } from "@/lib/doc-types";
import { InvoiceForm, type SourceInvoice } from "./invoice-form";

export const metadata = { title: "New invoice" };

const HELP: Record<DocType, string> = {
  INVOICE: "GST is split into CGST + SGST within your state, or IGST for other states, based on the place of supply.",
  CREDIT_NOTE: "Reduces an invoice: goods returned, a discount after billing, or over-charging. It reverses income and GST, puts returned stock back, and is set off against the original invoice's balance.",
  DEBIT_NOTE: "Adds to an invoice: under-charging or extra charges after billing. It posts like an invoice and can be paid like one.",
};

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ kind?: string; partyId?: string; doc?: string; from?: string }> }) {
  const sp = await searchParams;
  await requirePermission("accounting.write");
  const kind = sp.kind === "PURCHASE" ? "PURCHASE" : "SALES";
  const docType = DOC_TYPES.includes(sp.doc as DocType) ? (sp.doc as DocType) : "INVOICE";
  const note = docType !== "INVOICE";
  const [parties, accounts, items, costCentres, company, sources] = await Promise.all([
    lookups.parties(),
    lookups.accounts(),
    lookups.items(),
    lookups.costCentres(),
    db.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} }),
    note
      ? db.invoice.findMany({
          where: { kind, docType: "INVOICE", status: { not: "VOID" } },
          orderBy: { date: "desc" },
          take: 300,
          select: { id: true, number: true, partyId: true, date: true, placeOfSupply: true, total: true, vendorRef: true, lines: { orderBy: { sortOrder: "asc" } } },
        })
      : [],
  ]);
  const lineAccounts = accounts.filter((a) => (kind === "SALES" ? a.type === "INCOME" : a.type === "EXPENSE" || a.subtype === "FIXED_ASSET" || a.subtype === "INVENTORY"));
  const sourceInvoices: SourceInvoice[] = sources.map((s) => ({
    id: s.id,
    number: s.vendorRef ? `${s.number} / ${s.vendorRef}` : s.number,
    partyId: s.partyId,
    date: s.date.toISOString().slice(0, 10),
    placeOfSupply: s.placeOfSupply,
    total: s.total,
    lines: s.lines.map((l) => ({ itemId: l.itemId, description: l.description, hsnSac: l.hsnSac, quantity: l.quantity, rate: l.rate, discount: l.discount, taxRateBps: l.taxRateBps, accountId: l.accountId })),
  }));
  const from = sourceInvoices.find((s) => s.id === sp.from);
  const title = note ? `New ${docLabel(kind, docType).toLowerCase()}` : kind === "SALES" ? "New sales invoice" : "New purchase bill";
  return (
    <>
      <PageHeader title={title.charAt(0).toUpperCase() + title.slice(1)} description={HELP[docType]} />
      <InvoiceForm
        kind={kind}
        docType={docType}
        parties={parties}
        accounts={lineAccounts}
        items={items}
        costCentres={costCentres}
        companyState={company.stateCode}
        today={todayIso()}
        defaultPartyId={from?.partyId ?? sp.partyId}
        sourceInvoices={sourceInvoices}
        defaultSourceId={from?.id}
      />
    </>
  );
}
