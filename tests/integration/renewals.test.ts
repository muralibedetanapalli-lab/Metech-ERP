import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createRenewal, deleteRenewal, renew, setRenewalStatus } from "@/server/erp/renewals";
import { buildReport, trialBalance } from "@/server/accounting/reports";
import { projectCosting } from "@/server/projects/costing";
import { acc, resetDb } from "./helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("renewals (integration)", () => {
  beforeEach(resetDb);

  it("renews from the expiry date, books the expense to the project and keeps history", async () => {
    const project = await db.costCentre.create({ data: { code: "TENTOS", name: "TentOs", kind: "PROJECT" } });
    const vendor = await db.party.create({ data: { kind: "ORGANIZATION", name: "GoDaddy India", stateCode: "07", isVendor: true } });
    const bank = await acc("BANK");
    const r = await createRenewal({ name: "tentos.in", category: "DOMAIN", provider: "GoDaddy", vendorId: vendor.id, costCentreId: project.id, startDate: d("2025-12-01"), renewalDate: d("2026-12-01"), cycleMonths: 12, amount: 899_00, gstRateBps: 1800 });
    await expect(createRenewal({ name: "bad", startDate: d("2026-02-01"), renewalDate: d("2026-01-01") })).rejects.toThrow(/before the start date/);

    const after = await renew(r.id, { paidOn: d("2026-11-24"), amount: 999_00, gstRateBps: 1800, interState: true, bookExpense: true, paidFromId: bank.id, note: "Order 123" });
    expect(after.renewalDate.toISOString().slice(0, 10)).toBe("2027-12-01");
    expect(after.amount).toBe(999_00);
    const [h] = await db.renewalEvent.findMany({ where: { renewalId: r.id } });
    expect(h).toMatchObject({ amount: 999_00, gstAmount: 179_82, periodFrom: d("2026-12-01"), periodTo: d("2027-12-01") });
    const x = await db.expense.findUniqueOrThrow({ where: { id: h.expenseId! } });
    expect(x).toMatchObject({ costCentreId: project.id, partyId: vendor.id, amount: 999_00, interState: true });
    expect(x.description).toContain("tentos.in (2026-12-01 to 2027-12-01)");
    expect((await trialBalance(d("2027-03-31"))).balanced).toBe(true);
    const c = await projectCosting(d("2026-04-01"), d("2027-03-31"));
    expect(c.rows.find((p) => p.code === "TENTOS")?.directCost).toBe(999_00);

    await expect(deleteRenewal(r.id)).rejects.toThrow(/history/);
    await setRenewalStatus(r.id, "CANCELLED");
    await expect(renew(r.id, { paidOn: d("2026-11-25"), amount: 0, bookExpense: false })).rejects.toThrow(/Reactivate/);
  });

  it("needs a date for renewals without a fixed cycle, and can record a date without booking", async () => {
    const r = await createRenewal({ name: "Trademark", category: "LICENSE", startDate: d("2020-01-01"), renewalDate: d("2030-01-01"), cycleMonths: 0, amount: 0 });
    await expect(renew(r.id, { paidOn: d("2026-11-24"), amount: 0, bookExpense: false })).rejects.toThrow(/new renewal date/);
    await expect(renew(r.id, { paidOn: d("2026-11-24"), amount: 0, bookExpense: false, newRenewalDate: d("2029-01-01") })).rejects.toThrow(/after the current/);
    const after = await renew(r.id, { paidOn: d("2026-11-24"), amount: 0, bookExpense: false, newRenewalDate: d("2040-01-01") });
    expect(after.renewalDate.toISOString().slice(0, 10)).toBe("2040-01-01");
    expect(await db.expense.count()).toBe(0);
    await expect(renew(r.id, { paidOn: d("2026-11-24"), amount: 100_00, bookExpense: true, newRenewalDate: d("2050-01-01") })).rejects.toThrow(/bank or cash/);
  });

  it("lists active renewals with time left in the report", async () => {
    await createRenewal({ name: "Azure", category: "CLOUD", startDate: d("2026-01-01"), renewalDate: d("2026-12-01"), cycleMonths: 1, amount: 1_500_00 });
    const t = await buildReport("renewals", d("2026-04-01"), new Date("2026-11-24T23:59:59Z"));
    expect(t.rows[0]).toMatchObject({ name: "Azure", days: 7, left: "7 days left", cycle: "Monthly", yearly: 18_000_00 });
  });
});
