import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { systemAccountId } from "@/server/accounting/coa";
import { recordExpense } from "@/server/accounting/documents";
import { addMonths, RENEWAL_CATEGORIES } from "@/lib/renewals";

const optId = z.string().optional().nullable().transform((v) => v || null);

export const zRenewalInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    category: z.enum(Object.keys(RENEWAL_CATEGORIES) as [keyof typeof RENEWAL_CATEGORIES, ...(keyof typeof RENEWAL_CATEGORIES)[]]).default("OTHER"),
    provider: z.string().trim().max(100).optional().nullable(),
    reference: z.string().trim().max(120).optional().nullable(),
    vendorId: optId,
    costCentreId: optId,
    accountId: optId,
    startDate: z.coerce.date(),
    renewalDate: z.coerce.date(),
    cycleMonths: z.number().int().min(0).max(120).default(12),
    amount: z.number().int().min(0).default(0),
    gstRateBps: z.number().int().min(0).max(2800).default(1800),
    autoRenew: z.boolean().default(false),
    remindDays: z.number().int().min(0).max(365).default(30),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((r) => r.renewalDate.getTime() >= r.startDate.getTime(), { message: "Renewal date cannot be before the start date", path: ["renewalDate"] });
export type RenewalInput = z.input<typeof zRenewalInput>;

async function checkAccount(accountId: string | null) {
  if (!accountId) return;
  const a = await db.account.findUnique({ where: { id: accountId } });
  if (!a || a.type !== "EXPENSE") throw new AppError(400, "BAD_ACCOUNT", "Choose an expense account");
}

export async function createRenewal(raw: RenewalInput) {
  const input = zRenewalInput.parse(raw);
  await checkAccount(input.accountId);
  return db.renewal.create({ data: input });
}

export async function updateRenewal(id: string, raw: RenewalInput) {
  const input = zRenewalInput.parse(raw);
  await checkAccount(input.accountId);
  return db.renewal.update({ where: { id }, data: input });
}

export const zRenewInput = z.object({
  paidOn: z.coerce.date(),
  /** End of the new term; defaults to the current renewal date + one cycle. */
  newRenewalDate: z.coerce.date().optional().nullable(),
  amount: z.number().int().min(0),
  gstRateBps: z.number().int().min(0).max(2800).default(0),
  interState: z.boolean().default(false),
  /** Book the payment as an expense (paid from this bank / cash account). */
  bookExpense: z.boolean().default(true),
  paidFromId: z.string().optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});
export type RenewInput = z.input<typeof zRenewInput>;

/**
 * Record a renewal: the term runs on from the current renewal date (as domains and most subscriptions do) to the
 * new date, the renewal date moves forward, and the payment is optionally booked as an expense tagged with the
 * renewal's project and vendor (so it counts in project costing and input GST).
 */
export async function renew(id: string, raw: RenewInput, userId?: string) {
  const input = zRenewInput.parse(raw);
  return db.$transaction(async (tx) => {
    const r = await tx.renewal.findUniqueOrThrow({ where: { id } });
    if (r.status === "CANCELLED") throw new AppError(400, "CANCELLED", "Reactivate this renewal before renewing it");
    const periodFrom = r.renewalDate;
    const periodTo = input.newRenewalDate ?? (r.cycleMonths > 0 ? addMonths(r.renewalDate, r.cycleMonths) : null);
    if (!periodTo) throw new AppError(400, "NO_DATE", "This renewal has no fixed cycle: enter the new renewal date");
    if (periodTo.getTime() <= periodFrom.getTime()) throw new AppError(400, "BAD_DATE", "The new renewal date must be after the current one");
    let expenseId: string | null = null;
    let gstAmount = 0;
    if (input.bookExpense && input.amount > 0) {
      if (!input.paidFromId) throw new AppError(400, "NO_BANK", "Choose the bank or cash account it was paid from");
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const x = await recordExpense(
        {
          date: input.paidOn,
          accountId: r.accountId ?? (await systemAccountId(tx, "CLOUD_HOSTING")),
          paidFromId: input.paidFromId,
          partyId: r.vendorId,
          costCentreId: r.costCentreId,
          amount: input.amount,
          gstRateBps: input.gstRateBps,
          interState: input.interState,
          description: `Renewal: ${r.name} (${fmt(periodFrom)} to ${fmt(periodTo)})`.slice(0, 300),
          reference: r.reference,
        },
        userId,
        tx,
      );
      expenseId = x.id;
      gstAmount = x.gstAmount;
    }
    await tx.renewalEvent.create({ data: { renewalId: r.id, paidOn: input.paidOn, periodFrom, periodTo, amount: input.amount, gstAmount, expenseId, note: input.note ?? null } });
    return tx.renewal.update({ where: { id: r.id }, data: { renewalDate: periodTo, amount: input.amount, gstRateBps: input.gstRateBps } });
  });
}

export async function setRenewalStatus(id: string, status: "ACTIVE" | "CANCELLED") {
  return db.renewal.update({ where: { id }, data: { status } });
}

/** Delete only renewals that were never renewed here (history and expenses stay otherwise). */
export async function deleteRenewal(id: string) {
  const n = await db.renewalEvent.count({ where: { renewalId: id } });
  if (n) throw new AppError(409, "HAS_HISTORY", "It has renewal history; cancel it instead of deleting");
  await db.renewal.delete({ where: { id } });
}
