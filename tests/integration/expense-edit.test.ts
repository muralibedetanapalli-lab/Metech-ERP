import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { recordExpense, updateExpense } from "@/server/accounting/documents";
import { trialBalance } from "@/server/accounting/reports";
import { createRenewal, renew } from "@/server/erp/renewals";
import { acc, resetDb } from "./helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("editing an expense", () => {
  beforeEach(resetDb);

  it("voids the old entry, posts a corrected one and keeps the books balanced", async () => {
    const bank = await acc("BANK");
    const cash = await acc("CASH");
    const rent = await db.account.findFirstOrThrow({ where: { code: "5300" } });
    const cloud = await db.account.findFirstOrThrow({ where: { code: "5310" } });
    const x = await recordExpense({ date: d("2026-11-01"), accountId: rent.id, paidFromId: bank.id, amount: 10_000_00, gstRateBps: 1800, description: "Office rent" });
    const oldEntry = x.journalEntryId!;

    const y = await updateExpense(x.id, { date: d("2026-11-02"), accountId: cloud.id, paidFromId: cash.id, amount: 5_000_00, gstRateBps: 0, description: "Hosting" });
    expect(y).toMatchObject({ id: x.id, amount: 5_000_00, gstAmount: 0, description: "Hosting", accountId: cloud.id });
    expect(y.journalEntryId).not.toBe(oldEntry);
    expect(await db.journalEntry.findUniqueOrThrow({ where: { id: oldEntry } })).toMatchObject({ voided: true, voidReason: "Expense edited" });
    const fresh = await db.journalEntry.findUniqueOrThrow({ where: { id: y.journalEntryId! }, include: { lines: true } });
    expect(fresh).toMatchObject({ voided: false, sourceRef: `expense:${x.id}` });
    expect(fresh.lines.find((l) => l.accountId === cash.id)?.credit).toBe(5_000_00);

    // Edit again: still exactly one live entry.
    await updateExpense(x.id, { date: d("2026-11-02"), accountId: cloud.id, paidFromId: cash.id, amount: 6_000_00, description: "Hosting" });
    expect(await db.journalEntry.count({ where: { sourceRef: { startsWith: `expense:${x.id}` }, voided: false } })).toBe(1);
    const tb = await trialBalance(d("2027-03-31"));
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.code === "5300")).toBeUndefined();
    expect(tb.rows.find((r) => r.code === "5310")?.debit).toBe(6_000_00);
  });

  it("updates the renewal history amount for a renewal payment", async () => {
    const bank = await acc("BANK");
    const r = await createRenewal({ name: "veloft.in", category: "DOMAIN", startDate: d("2025-06-26"), renewalDate: d("2026-06-26"), cycleMonths: 12, amount: 899_00, gstRateBps: 1800 });
    await renew(r.id, { paidOn: d("2026-06-20"), amount: 899_00, gstRateBps: 1800, bookExpense: true, paidFromId: bank.id });
    const h = await db.renewalEvent.findFirstOrThrow({ where: { renewalId: r.id } });
    const x = await db.expense.findUniqueOrThrow({ where: { id: h.expenseId! } });
    await updateExpense(x.id, { date: x.date, accountId: x.accountId, paidFromId: x.paidFromId, amount: 999_00, gstRateBps: 1800, description: x.description });
    expect(await db.renewalEvent.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ amount: 999_00, gstAmount: 179_82 });
  });
});
