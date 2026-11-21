import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { PageHeader } from "@/components/page";
import { todayIso } from "@/lib/dates";
import { InvoiceForm } from "./invoice-form";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ kind?: string; partyId?: string }> }) {
  const sp = await searchParams;
  await requirePermission("accounting.write");
  const kind = sp.kind === "PURCHASE" ? "PURCHASE" : "SALES";
  const [parties, accounts, items, costCentres, company] = await Promise.all([
    lookups.parties(),
    lookups.accounts(),
    lookups.items(),
    lookups.costCentres(),
    db.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} }),
  ]);
  const lineAccounts = accounts.filter((a) => (kind === "SALES" ? a.type === "INCOME" : a.type === "EXPENSE" || a.subtype === "FIXED_ASSET" || a.subtype === "INVENTORY"));
  return (
    <>
      <PageHeader title={kind === "SALES" ? "New sales invoice" : "New purchase bill"} description="GST is split into CGST + SGST within your state, or IGST for other states, based on the place of supply." />
      <InvoiceForm
        kind={kind}
        parties={parties}
        accounts={lineAccounts}
        items={items}
        costCentres={costCentres}
        companyState={company.stateCode}
        today={todayIso()}
        defaultPartyId={sp.partyId}
      />
    </>
  );
}
