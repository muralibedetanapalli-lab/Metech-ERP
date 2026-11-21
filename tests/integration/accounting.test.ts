import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createInvoice, recordExpense, recordPayment, voidInvoice } from "@/server/accounting/documents";
import { post } from "@/server/accounting/ledger";
import { balanceSheet, gstSummary, ledger, profitAndLoss, trialBalance } from "@/server/accounting/reports";
import { runPayroll } from "@/server/erp/payroll";
import { toPdf, toXlsx } from "@/server/export";
import { buildReport } from "@/server/accounting/reports";
import { acc, resetDb } from "./helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const range = { from: d("2026-04-01"), to: new Date("2027-03-31T23:59:59Z") };

async function parties() {
  const customer = await db.party.create({ data: { kind: "ORGANIZATION", name: "Acme Retail", stateCode: "36", isCustomer: true } });
  const outOfState = await db.party.create({ data: { kind: "ORGANIZATION", name: "Bengaluru Foods", stateCode: "29" } });
  const vendor = await db.party.create({ data: { kind: "ORGANIZATION", name: "Cloud Vendor", stateCode: "29", isVendor: true } });
  return { customer, outOfState, vendor };
}

describe("accounting (integration)", () => {
  beforeEach(resetDb);

  it("posts a GST sales invoice, settles it with a receipt and keeps the books balanced", async () => {
    const { customer } = await parties();
    const bank = await acc("BANK");
    const inv = await createInvoice({ kind: "SALES", partyId: customer.id, date: d("2026-11-01"), placeOfSupply: "36", lines: [{ description: "Website maintenance", hsnSac: "998314", quantity: 1, rate: 100_000_00, discount: 0, taxRateBps: 1800 }] });
    expect(inv).toMatchObject({ status: "POSTED", taxableAmount: 100_000_00, cgst: 9_000_00, sgst: 9_000_00, igst: 0, total: 118_000_00 });
    expect(inv.number).toMatch(/^MS\/2026-27\/0001$/);

    let tb = await trialBalance(range.to);
    expect(tb.balanced).toBe(true);
    expect((await ledger({ partyId: customer.id, ...range })).closingBalance).toBe(118_000_00);

    await recordPayment({ kind: "RECEIPT", date: d("2026-11-10"), partyId: customer.id, amount: 50_000_00, bankAccountId: bank.id, mode: "UPI", allocations: [{ invoiceId: inv.id, amount: 50_000_00 }] });
    expect(await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ status: "PARTIAL", amountPaid: 50_000_00 });
    await recordPayment({ kind: "RECEIPT", date: d("2026-11-20"), partyId: customer.id, amount: 68_000_00, bankAccountId: bank.id, mode: "BANK", allocations: [{ invoiceId: inv.id, amount: 68_000_00 }] });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await expect(recordPayment({ kind: "RECEIPT", date: d("2026-11-21"), partyId: customer.id, amount: 1_00, bankAccountId: bank.id, mode: "BANK", allocations: [{ invoiceId: inv.id, amount: 1_00 }] })).rejects.toThrow(/is due/);

    tb = await trialBalance(range.to);
    expect(tb.balanced).toBe(true);
    const pl = await profitAndLoss(range.from, range.to);
    expect(pl.totalIncome).toBe(100_000_00);
    const bs = await balanceSheet(range.to);
    expect(bs.balanced).toBe(true);
    expect(bs.profit).toBe(100_000_00);
  });

  it("uses IGST for other states, books purchases with input credit and nets GST payable", async () => {
    const { outOfState, vendor } = await parties();
    await createInvoice({ kind: "SALES", partyId: outOfState.id, date: d("2026-11-02"), placeOfSupply: "29", lines: [{ description: "App development", quantity: 2, rate: 25_000_00, discount: 0, taxRateBps: 1800 }] });
    const bill = await createInvoice({ kind: "PURCHASE", partyId: vendor.id, date: d("2026-11-03"), placeOfSupply: "36", vendorRef: "CV-77", lines: [{ description: "Servers", quantity: 1, rate: 10_000_00, discount: 0, taxRateBps: 1800 }] });
    expect(bill).toMatchObject({ igst: 1_800_00, total: 11_800_00 });
    const g = await gstSummary(range.from, range.to);
    expect(g.outward.igst).toBe(9_000_00);
    expect(g.input.igst).toBe(1_800_00);
    expect(g.netPayable).toBe(7_200_00);
    expect(g.rows).toHaveLength(2);
    expect((await trialBalance(range.to)).balanced).toBe(true);
  });

  it("records expenses with input GST and voids invoices cleanly", async () => {
    const { customer } = await parties();
    const [rent, bank] = await Promise.all([acc("RENT"), acc("BANK")]);
    await recordExpense({ date: d("2026-11-05"), accountId: rent.id, paidFromId: bank.id, amount: 20_000_00, gstRateBps: 1800, interState: false, description: "Office rent November" });
    const pl = await profitAndLoss(range.from, range.to);
    expect(pl.totalExpense).toBe(20_000_00);
    const item = await db.item.create({ data: { sku: "KIT-1", name: "POS kit", salePrice: 5_000_00, stock: 10 } });
    const inv = await createInvoice({ kind: "SALES", partyId: customer.id, date: d("2026-11-06"), placeOfSupply: "36", lines: [{ itemId: item.id, description: "POS kit", quantity: 3, rate: 5_000_00, discount: 0, taxRateBps: 1800 }] });
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).stock).toBe(7);
    await voidInvoice(inv.id, "Raised in error");
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).stock).toBe(10);
    expect((await profitAndLoss(range.from, range.to)).totalIncome).toBe(0);
    expect((await trialBalance(range.to)).balanced).toBe(true);
  });

  it("rejects unbalanced manual journals and runs payroll once per month", async () => {
    const [bank, capital] = await Promise.all([acc("BANK"), acc("CAPITAL")]);
    await expect(post({ date: d("2026-04-01"), narration: "bad", lines: [{ accountId: bank.id, debit: 100 }, { accountId: capital.id, credit: 90 }] })).rejects.toThrow(/equal/);
    await post({ date: d("2026-04-01"), narration: "Capital introduced", source: "OPENING", lines: [{ accountId: bank.id, debit: 500_000_00 }, { accountId: capital.id, credit: 500_000_00 }] });
    await db.employee.create({ data: { code: "E1", name: "Asha", joinDate: d("2026-04-01"), basic: 30_000_00, hra: 12_000_00, otherAllow: 8_000_00, monthlyCtc: 50_000_00 } });
    const r = await runPayroll("2026-11");
    expect(r).toMatchObject({ count: 1, gross: 50_000_00, net: 48_000_00 });
    await expect(runPayroll("2026-11")).rejects.toThrow(/already/);
    expect((await trialBalance(range.to)).balanced).toBe(true);
    expect((await balanceSheet(range.to)).balanced).toBe(true);
  });

  it("exports reports to Excel and PDF", async () => {
    const { customer } = await parties();
    await createInvoice({ kind: "SALES", partyId: customer.id, date: d("2026-11-01"), placeOfSupply: "36", lines: [{ description: "Consulting — ₹ fees", quantity: 1, rate: 1_000_00, discount: 0, taxRateBps: 1800 }] });
    const t = await buildReport("gst-summary", range.from, range.to);
    const xlsx = await toXlsx(t, "Metech Solutions");
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    const pdf = await toPdf(await buildReport("trial-balance", range.from, range.to), "Metech Solutions");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
