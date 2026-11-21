import "server-only";
import { db } from "@/server/db";
import { isValidGstin } from "@/lib/gst";
import { accountSums } from "./reports";
import { buildGstr1, type Gstr1Doc } from "./gstr1-build";

export { buildGstr1 } from "./gstr1-build";
export type { Gstr1Result, Gstr1Doc } from "./gstr1-build";

/** "2026-11" → [first day, last day] as UTC-midnight accounting dates. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

/** GSTR-1 for one month from the sales invoices, credit notes and debit notes raised in Metech ERP. */
export async function gstr1ForMonth(month: string) {
  const { from, to } = monthRange(month);
  const [company, invoices, sums] = await Promise.all([
    db.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} }),
    db.invoice.findMany({
      where: { kind: "SALES", date: { gte: from, lte: to } },
      include: { party: { select: { name: true, gstin: true } }, lines: { include: { item: { select: { unit: true, kind: true } } } }, originalInvoice: { select: { total: true } } },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    accountSums({ from, to }),
  ]);
  const docs: Gstr1Doc[] = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    docType: i.docType,
    date: i.date.toISOString().slice(0, 10),
    void: i.status === "VOID",
    partyName: i.party.name,
    gstin: i.party.gstin && isValidGstin(i.party.gstin) ? i.party.gstin : null,
    rawGstin: i.party.gstin,
    placeOfSupply: i.placeOfSupply,
    total: i.total,
    originalTotal: i.originalInvoice?.total ?? null,
    lines: i.lines.map((l) => ({
      description: l.description,
      hsnSac: l.hsnSac,
      unit: l.item?.unit ?? null,
      service: l.item ? l.item.kind === "SERVICE" : (l.hsnSac ?? "").startsWith("99"),
      quantity: l.quantity,
      taxRateBps: l.taxRateBps,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
    })),
  }));
  const out = (code: string) => {
    const a = sums.find((s) => s.code === code);
    return (a?.credit ?? 0) - (a?.debit ?? 0);
  };
  const ledgerOutputTax = out("2100") + out("2101") + out("2102");
  return buildGstr1({ gstin: company.gstin, companyState: company.stateCode, month, docs, ledgerOutputTax });
}
