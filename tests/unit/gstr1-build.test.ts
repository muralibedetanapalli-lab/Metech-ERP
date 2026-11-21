import { describe, expect, it } from "vitest";
import { buildGstr1, type Gstr1Doc } from "@/server/accounting/gstr1-build";

const doc = (p: Partial<Gstr1Doc>): Gstr1Doc => ({
  id: p.number ?? "x",
  number: "MS/2026-27/0001",
  docType: "INVOICE",
  date: "2026-10-10",
  void: false,
  partyName: "Buyer",
  gstin: null,
  rawGstin: null,
  placeOfSupply: "36",
  total: 0,
  originalTotal: null,
  lines: [],
  ...p,
});
const goods = (taxable: number, inter: boolean, extra: Partial<Gstr1Doc["lines"][number]> = {}) => {
  const tax = Math.round(taxable * 0.18);
  return { description: "Router", hsnSac: "8517", unit: "pcs", service: false, quantity: 1, taxRateBps: 1800, taxable, cgst: inter ? 0 : tax / 2, sgst: inter ? 0 : tax / 2, igst: inter ? tax : 0, ...extra };
};

describe("GSTR-1 builder", () => {
  it("reports notes on large inter-state B2C invoices as cdnur and warns about bad GSTINs and gaps", () => {
    const inv = doc({ number: "MS/1", placeOfSupply: "07", total: 1_77_000_00, lines: [goods(1_50_000_00, true, { quantity: 5 })] });
    const cn = doc({ number: "CN/1", docType: "CREDIT_NOTE", placeOfSupply: "07", total: 11_800_00, originalTotal: inv.total, lines: [goods(10_000_00, true, { quantity: 1 })] });
    const bad = doc({ number: "MS/2", rawGstin: "36BADGSTIN", total: 1_180_00, lines: [goods(1_000_00, false, { hsnSac: null, unit: "widgets" })] });
    const g = buildGstr1({ gstin: null, companyState: "36", month: "2026-10", docs: [inv, cn, bad], ledgerOutputTax: 0 });
    const j = g.json as Record<string, any>;
    expect(j.cdnur).toEqual([{ typ: "B2CL", ntty: "C", nt_num: "CN/1", nt_dt: "10-10-2026", val: 11_800, pos: "07", itms: [{ num: 1, itm_det: { txval: 10_000, rt: 18, iamt: 1_800, csamt: 0 } }] }]);
    expect(j.b2cs).toEqual([{ sply_ty: "INTRA", pos: "36", typ: "OE", rt: 18, txval: 1_000, camt: 90, samt: 90, csamt: 0 }]);
    // HSN B2C: 5 sold − 1 returned of 8517 in PCS; the unknown unit maps to OTH.
    expect(j.hsn.hsn_b2c.find((r: { hsn_sc: string }) => r.hsn_sc === "8517")).toMatchObject({ uqc: "PCS", qty: 4, txval: 1_40_000, iamt: 25_200 });
    expect(j.hsn.hsn_b2c.find((r: { hsn_sc: string }) => r.hsn_sc === "")).toMatchObject({ uqc: "OTH" });
    expect(g.warnings.join("\n")).toMatch(/Company GSTIN is not set/);
    expect(g.warnings.join("\n")).toMatch(/MS\/2: GSTIN "36BADGSTIN"/);
    expect(g.warnings.join("\n")).toMatch(/without HSN/);
    expect(g.warnings.join("\n")).toMatch(/differs/);
  });

  it("warns when credit notes make a B2CS row negative", () => {
    const cn = doc({ number: "CN/1", docType: "CREDIT_NOTE", total: 1_180_00, lines: [goods(1_000_00, false)] });
    const g = buildGstr1({ gstin: "36AABCM1234F1ZY", companyState: "36", month: "2026-10", docs: [cn], ledgerOutputTax: -180_00 });
    expect((g.json as Record<string, any>).b2cs[0].txval).toBe(-1_000);
    expect(g.warnings).toHaveLength(1);
    expect(g.warnings[0]).toMatch(/negative/);
  });
});
