import { describe, expect, it } from "vitest";
import { computeGstLine, computeInvoiceTotals, isValidGstin, stateCodeFromName } from "@/lib/gst";
import { assertBalanced, fiscalYear } from "@/server/accounting/ledger";
import { computePayslip, professionalTax } from "@/server/erp/payroll";
import { parseStatementCsv } from "@/server/accounting/bank";
import { parseRupees } from "@/lib/money";
import { bookValue } from "@/lib/depreciation";

/** Build a GSTIN with a correct check digit from its first 14 characters. */
export function withCheckDigit(first14: string) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = chars.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + chars[(36 - (sum % 36)) % 36];
}

describe("GST", () => {
  it("splits intra-state tax into CGST + SGST and inter-state into IGST", () => {
    expect(computeGstLine({ quantity: 2, rate: 50_000, taxRateBps: 1800 }, false)).toEqual({ taxable: 100_000, cgst: 9_000, sgst: 9_000, igst: 0, amount: 118_000 });
    expect(computeGstLine({ quantity: 2, rate: 50_000, taxRateBps: 1800 }, true)).toEqual({ taxable: 100_000, cgst: 0, sgst: 0, igst: 18_000, amount: 118_000 });
    // Odd paisa goes to SGST so the halves always add up.
    const odd = computeGstLine({ quantity: 1, rate: 1_001, taxRateBps: 1800 }, false);
    expect(odd.cgst + odd.sgst).toBe(180);
    expect(computeGstLine({ quantity: 1, rate: 10_000, discount: 1_000, taxRateBps: 500 }, false).taxable).toBe(9_000);
  });

  it("decides inter/intra-state from supplier state vs place of supply", () => {
    const lines = [{ quantity: 1, rate: 100_000, taxRateBps: 1800 }, { quantity: 3, rate: 10_000, taxRateBps: 1200 }];
    const intra = computeInvoiceTotals(lines, "36", "36");
    expect(intra).toMatchObject({ interState: false, taxableAmount: 130_000, cgst: 10_800, sgst: 10_800, igst: 0, total: 151_600 });
    expect(computeInvoiceTotals(lines, "36", "29")).toMatchObject({ interState: true, igst: 21_600, total: 151_600 });
  });

  it("validates GSTIN format and checksum", () => {
    const good = withCheckDigit("36AABCM1234D1Z");
    expect(isValidGstin(good)).toBe(true);
    expect(isValidGstin(good.slice(0, 14) + (good[14] === "A" ? "B" : "A"))).toBe(false);
    expect(isValidGstin("36ABC")).toBe(false);
    expect(stateCodeFromName("Telangana")).toBe("36");
    expect(stateCodeFromName("karnataka")).toBe("29");
    expect(stateCodeFromName("Atlantis")).toBeNull();
  });
});

describe("ledger helpers", () => {
  it("labels Indian financial years", () => {
    expect(fiscalYear(new Date("2026-11-21"))).toBe("2026-27");
    expect(fiscalYear(new Date("2027-03-31"))).toBe("2026-27");
    expect(fiscalYear(new Date("2027-04-01"))).toBe("2027-28");
  });
  it("rejects unbalanced, one-line and zero entries", () => {
    expect(() => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).not.toThrow();
    expect(() => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }])).toThrow(/equal/);
    expect(() => assertBalanced([{ debit: 100, credit: 0 }])).toThrow(/two lines/);
  });
  it("parses rupee input into paise", () => {
    expect(parseRupees("1,250.50")).toBe(125_050);
    expect(parseRupees("₹ 99")).toBe(9_900);
    expect(parseRupees("")).toBe(0);
    expect(() => parseRupees("abc")).toThrow();
  });
});

describe("payroll", () => {
  it("applies PF on basic up to the wage ceiling and Telangana PT slabs", () => {
    expect(professionalTax(15_000_00)).toBe(0);
    expect(professionalTax(18_000_00)).toBe(150_00);
    expect(professionalTax(50_000_00)).toBe(200_00);
    const s = computePayslip({ basic: 30_000_00, hra: 12_000_00, otherAllow: 8_000_00, pfApplicable: true });
    expect(s).toMatchObject({ gross: 50_000_00, pfEmployee: 1_800_00, professionalTax: 200_00, net: 50_000_00 - 1_800_00 - 200_00 });
  });
});

describe("bank statement CSV", () => {
  it("reads signed-amount and withdrawal/deposit layouts", () => {
    expect(parseStatementCsv('Date,Description,Amount,Reference\n2026-11-01,"Cashfree settlement, batch 7",12500.50,UTR1\n02/11/2026,Bank charges,-59,')).toEqual([
      { date: new Date("2026-11-01T00:00:00Z"), description: "Cashfree settlement, batch 7", reference: "UTR1", amount: 1_250_050 },
      { date: new Date("2026-11-02T00:00:00Z"), description: "Bank charges", reference: null, amount: -5_900 },
    ]);
    expect(parseStatementCsv("Txn Date,Narration,Withdrawal,Deposit\n03/11/2026,Rent,25000,\n04/11/2026,Client,,1000")).toMatchObject([{ amount: -2_500_000 }, { amount: 100_000 }]);
    expect(() => parseStatementCsv("foo,bar\n1,2")).toThrow(/columns/);
  });
});

describe("assets", () => {
  it("depreciates straight-line by whole months and stops at salvage value", () => {
    const a = { cost: 120_000_00, salvageValue: 0, usefulLifeMonths: 36, purchaseDate: new Date("2026-01-15") };
    expect(bookValue(a, new Date("2026-07-15"))).toEqual({ depreciation: 20_000_00, value: 100_000_00 });
    expect(bookValue(a, new Date("2030-01-01")).value).toBe(0);
  });
});
