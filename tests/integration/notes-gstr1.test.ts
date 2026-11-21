import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createInvoice, recordPayment, voidInvoice } from "@/server/accounting/documents";
import { gstSummary, ledger, outstanding, trialBalance } from "@/server/accounting/reports";
import { gstr1ForMonth } from "@/server/accounting/gstr1";
import { acc, resetDb } from "./helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const range = { from: d("2026-04-01"), to: new Date("2027-03-31T23:59:59Z") };
const line = (rate: number, extra: Record<string, unknown> = {}) => ({ description: "Consulting", hsnSac: "998311", quantity: 1, rate, discount: 0, taxRateBps: 1800, ...extra });

describe("credit / debit notes and GSTR-1 (integration)", () => {
  beforeEach(resetDb);

  it("a credit note reverses income and GST, is set off against the invoice, and can be voided", async () => {
    const customer = await db.party.create({ data: { kind: "ORGANIZATION", name: "Acme Retail", stateCode: "36", gstin: "36AABCM1234F1ZY" } });
    const inv = await createInvoice({ kind: "SALES", partyId: customer.id, date: d("2026-11-01"), placeOfSupply: "36", lines: [line(100_000_00)] });
    await expect(createInvoice({ kind: "SALES", docType: "CREDIT_NOTE", partyId: customer.id, originalInvoiceId: inv.id, date: d("2026-11-05"), placeOfSupply: "36", lines: [line(10_000_00)] })).rejects.toThrow(/reason/);

    const cn = await createInvoice({ kind: "SALES", docType: "CREDIT_NOTE", partyId: customer.id, originalInvoiceId: inv.id, noteReason: "Discount agreed", date: d("2026-11-05"), placeOfSupply: "36", lines: [line(10_000_00)] });
    expect(cn.number).toBe("CN/2026-27/0001");
    expect(await db.invoice.findUniqueOrThrow({ where: { id: cn.id } })).toMatchObject({ total: 11_800_00, amountPaid: 11_800_00, status: "PAID" });
    expect(await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ amountPaid: 11_800_00, status: "PARTIAL" });

    // Customer now owes 1,18,000 − 11,800; GST and receivable both reduced.
    expect((await ledger({ partyId: customer.id, ...range })).closingBalance).toBe(106_200_00);
    const g = await gstSummary(range.from, range.to);
    expect(g.outward.cgst + g.outward.sgst).toBe(16_200_00);
    expect(g.rows.find((r) => r.number === cn.number)?.total).toBe(-11_800_00);
    expect((await trialBalance(range.to)).balanced).toBe(true);

    // Payments cannot go to a credit note, and the invoice can only be voided after its notes.
    const bank = await acc("BANK");
    await expect(recordPayment({ kind: "RECEIPT", date: d("2026-11-06"), partyId: customer.id, amount: 1_00, bankAccountId: bank.id, allocations: [{ invoiceId: cn.id, amount: 1_00 }] })).rejects.toThrow(/credit note/);
    await expect(voidInvoice(inv.id, "test")).rejects.toThrow(/notes/);
    await voidInvoice(cn.id, "Wrong discount");
    expect(await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ amountPaid: 0, status: "POSTED" });
    expect((await ledger({ partyId: customer.id, ...range })).closingBalance).toBe(118_000_00);
  });

  it("puts returned stock back, keeps any excess as open credit, and debit notes add to the bill", async () => {
    const customer = await db.party.create({ data: { kind: "PERSON", name: "Walk-in", stateCode: "36" } });
    const item = await db.item.create({ data: { sku: "CAM-1", name: "Camera", stock: 10, taxRateBps: 1800, hsnSac: "8525" } });
    const inv = await createInvoice({ kind: "SALES", partyId: customer.id, date: d("2026-11-01"), placeOfSupply: "36", lines: [line(1_000_00, { itemId: item.id, quantity: 3, hsnSac: "8525" })] });
    const bank = await acc("BANK");
    await recordPayment({ kind: "RECEIPT", date: d("2026-11-02"), partyId: customer.id, amount: inv.total, bankAccountId: bank.id, allocations: [{ invoiceId: inv.id, amount: inv.total }] });
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).stock).toBe(7);

    // Return one camera after full payment: nothing left to set off, so it is open credit.
    const cn = await createInvoice({ kind: "SALES", docType: "CREDIT_NOTE", partyId: customer.id, originalInvoiceId: inv.id, noteReason: "Returned", date: d("2026-11-03"), placeOfSupply: "36", lines: [line(1_000_00, { itemId: item.id, quantity: 1, hsnSac: "8525" })] });
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).stock).toBe(8);
    expect(await db.invoice.findUniqueOrThrow({ where: { id: cn.id } })).toMatchObject({ amountPaid: 0, status: "POSTED" });
    const open = await outstanding("SALES", d("2026-11-30"));
    expect(open.find((o) => o.id === cn.id)).toMatchObject({ balance: -1_180_00, bucket: "Credit" });

    const dn = await createInvoice({ kind: "SALES", docType: "DEBIT_NOTE", partyId: customer.id, originalInvoiceId: inv.id, noteReason: "Delivery charge", date: d("2026-11-04"), placeOfSupply: "36", lines: [line(200_00)] });
    expect(dn.number).toBe("DN/2026-27/0001");
    expect(dn.total).toBe(236_00);
    expect((await ledger({ partyId: customer.id, ...range })).closingBalance).toBe(-1_180_00 + 236_00);
    expect((await trialBalance(range.to)).balanced).toBe(true);
  });

  it("a vendor credit note reduces the payable and input GST", async () => {
    const vendor = await db.party.create({ data: { kind: "ORGANIZATION", name: "Cloud Vendor", stateCode: "29" } });
    const bill = await createInvoice({ kind: "PURCHASE", partyId: vendor.id, date: d("2026-11-03"), placeOfSupply: "36", vendorRef: "CV-77", lines: [line(10_000_00)] });
    const pcn = await createInvoice({ kind: "PURCHASE", docType: "CREDIT_NOTE", partyId: vendor.id, originalInvoiceId: bill.id, noteReason: "Service credit", vendorRef: "CV-CN-1", date: d("2026-11-10"), placeOfSupply: "36", lines: [line(1_000_00)] });
    expect(pcn.number).toBe("PCN/2026-27/0001");
    expect(await db.invoice.findUniqueOrThrow({ where: { id: bill.id } })).toMatchObject({ amountPaid: 1_180_00, status: "PARTIAL" });
    const g = await gstSummary(range.from, range.to);
    expect(g.input.igst).toBe(1_800_00 - 180_00);
    expect((await ledger({ partyId: vendor.id, ...range })).closingBalance).toBe(-(11_800_00 - 1_180_00));
  });

  it("builds GSTR-1 sections from the month's invoices and notes", async () => {
    await db.companySettings.update({ where: { id: "company" }, data: { gstin: "36AABCM1234F1ZY" } });
    const reg = await db.party.create({ data: { kind: "ORGANIZATION", name: "Bengaluru Foods", stateCode: "29", gstin: "29AAACB5678K1Z6" } });
    const local = await db.party.create({ data: { kind: "PERSON", name: "Local buyer", stateCode: "36" } });
    const big = await db.party.create({ data: { kind: "PERSON", name: "Delhi buyer", stateCode: "07" } });
    const b2b = await createInvoice({ kind: "SALES", partyId: reg.id, date: d("2026-10-05"), placeOfSupply: "29", lines: [line(50_000_00), line(10_000_00, { taxRateBps: 1200, hsnSac: "9983" })] });
    await createInvoice({ kind: "SALES", partyId: local.id, date: d("2026-10-06"), placeOfSupply: "36", lines: [line(2_000_00)] });
    await createInvoice({ kind: "SALES", partyId: big.id, date: d("2026-10-07"), placeOfSupply: "07", lines: [line(1_50_000_00)] });
    await createInvoice({ kind: "SALES", docType: "CREDIT_NOTE", partyId: reg.id, originalInvoiceId: b2b.id, noteReason: "Rate correction", date: d("2026-10-20"), placeOfSupply: "29", lines: [line(5_000_00)] });
    const voided = await createInvoice({ kind: "SALES", partyId: local.id, date: d("2026-10-21"), placeOfSupply: "36", lines: [line(100_00)] });
    await voidInvoice(voided.id, "Duplicate");
    await createInvoice({ kind: "SALES", partyId: local.id, date: d("2026-11-01"), placeOfSupply: "36", lines: [line(999_00)] }); // next month

    const g = await gstr1ForMonth("2026-10");
    const j = g.json as Record<string, any>;
    expect(j).toMatchObject({ gstin: "36AABCM1234F1ZY", fp: "102026" });
    expect(j.b2b).toHaveLength(1);
    expect(j.b2b[0].ctin).toBe("29AAACB5678K1Z6");
    expect(j.b2b[0].inv[0]).toMatchObject({ inum: b2b.number, idt: "05-10-2026", val: 70_200, pos: "29", rchrg: "N", inv_typ: "R" });
    expect(j.b2b[0].inv[0].itms).toEqual([
      { num: 1, itm_det: { txval: 10_000, rt: 12, iamt: 1_200, camt: 0, samt: 0, csamt: 0 } },
      { num: 2, itm_det: { txval: 50_000, rt: 18, iamt: 9_000, camt: 0, samt: 0, csamt: 0 } },
    ]);
    expect(j.b2cl[0]).toMatchObject({ pos: "07" });
    expect(j.b2cl[0].inv[0].itms[0].itm_det).toEqual({ txval: 150_000, rt: 18, iamt: 27_000, csamt: 0 });
    expect(j.b2cs).toEqual([{ sply_ty: "INTRA", pos: "36", typ: "OE", rt: 18, txval: 2_000, camt: 180, samt: 180, csamt: 0 }]);
    expect(j.cdnr[0].nt[0]).toMatchObject({ ntty: "C", nt_num: "CN/2026-27/0001", val: 5_900, pos: "29" });
    expect(j.doc_issue.doc_det).toEqual([
      { doc_num: 1, docs: [{ num: 1, from: "MS/2026-27/0001", to: "MS/2026-27/0004", totnum: 4, cancel: 1, net_issue: 3 }] },
      { doc_num: 5, docs: [{ num: 1, from: "CN/2026-27/0001", to: "CN/2026-27/0001", totnum: 1, cancel: 0, net_issue: 1 }] },
    ]);
    // HSN: B2B nets the credit note into 998311 @18%.
    const h = j.hsn.hsn_b2b.find((r: { hsn_sc: string; rt: number }) => r.hsn_sc === "998311" && r.rt === 18);
    expect(h).toMatchObject({ uqc: "NA", qty: 0, txval: 45_000, iamt: 8_100 });
    expect(g.docTax).toBe(g.ledgerTax);
    expect(g.warnings).toEqual([]);
  });
});
