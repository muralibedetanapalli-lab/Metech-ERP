"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { req, run, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { createInvoice, recordExpense, recordPayment, voidInvoice } from "@/server/accounting/documents";
import { post, voidEntry } from "@/server/accounting/ledger";
import { parseRupees } from "@/lib/money";
import { dayDate } from "@/lib/dates";
import type { ActionState } from "@/lib/action-state";
import { parseStatementCsv } from "@/server/accounting/bank";

const ACC_PATHS = ["/", "/accounting/journal", "/accounting/invoices", "/accounting/payments", "/accounting/expenses", "/accounting/accounts", "/reports"];

/** Invoice form posts its lines as JSON (built by the client form). */
export async function saveInvoice(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const user = await requirePermission("accounting.write");
    const payload = JSON.parse(req(fd, "payload"));
    const due = str(fd, "dueDate");
    id = (
      await createInvoice(
        { ...payload, date: dayDate(req(fd, "date", "Date")), dueDate: due ? dayDate(due) : null, vendorRef: str(fd, "vendorRef"), notes: str(fd, "notesText"), costCentreId: str(fd, "costCentreId") },
        user.id,
      )
    ).id;
  }, ACC_PATHS);
  if (r.ok) redirect(`/accounting/invoices/${id}`);
  return r;
}

export async function voidInvoiceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("accounting.write");
    await voidInvoice(req(fd, "id"), str(fd, "reason") ?? "Voided");
    return "Invoice voided";
  }, ACC_PATHS);
}

export async function savePayment(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("accounting.write");
    const allocations = JSON.parse(str(fd, "allocations") ?? "[]") as { invoiceId: string; amount: number }[];
    const p = await recordPayment(
      {
        kind: req(fd, "kind") as "RECEIPT" | "PAYMENT",
        date: dayDate(req(fd, "date", "Date")),
        partyId: str(fd, "partyId"),
        counterAccountId: str(fd, "counterAccountId"),
        amount: parseRupees(fd.get("amount")),
        bankAccountId: req(fd, "bankAccountId", "Bank / cash account"),
        mode: str(fd, "mode") ?? "BANK",
        reference: str(fd, "reference"),
        notes: str(fd, "notes"),
        allocations: allocations.filter((a) => a.amount > 0),
      },
      user.id,
    );
    return `${p.kind === "RECEIPT" ? "Receipt" : "Payment"} ${p.number} recorded`;
  }, ACC_PATHS);
}

export async function saveExpense(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("accounting.write");
    await recordExpense(
      {
        date: dayDate(req(fd, "date", "Date")),
        accountId: req(fd, "accountId", "Expense account"),
        paidFromId: req(fd, "paidFromId", "Paid from"),
        partyId: str(fd, "partyId"),
        costCentreId: str(fd, "costCentreId"),
        amount: parseRupees(fd.get("amount")),
        gstRateBps: Number(str(fd, "gstRateBps") ?? 0),
        interState: fd.get("interState") === "on",
        description: req(fd, "description", "Description"),
        reference: str(fd, "reference"),
      },
      user.id,
    );
    return "Expense recorded";
  }, ACC_PATHS);
}

const zJournal = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  narration: z.string().trim().min(1, "Narration is required"),
  lines: z.array(z.object({ accountId: z.string().min(1), debit: z.number().int().min(0), credit: z.number().int().min(0), partyId: z.string().optional().nullable(), costCentreId: z.string().optional().nullable(), memo: z.string().optional().nullable() })),
});

export async function saveJournal(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const user = await requirePermission("accounting.write");
    const j = zJournal.parse(JSON.parse(req(fd, "payload")));
    const { entry } = await post({
      date: dayDate(j.date),
      narration: j.narration,
      source: fd.get("opening") === "1" ? "OPENING" : "MANUAL",
      createdById: user.id,
      lines: j.lines.map((l) => ({ ...l, partyId: l.partyId || null, costCentreId: l.costCentreId || null })),
    });
    id = entry.id;
  }, ACC_PATHS);
  if (r.ok) redirect(`/accounting/journal/${id}`);
  return r;
}

export async function voidJournal(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("accounting.write");
    const id = req(fd, "id");
    const e = await db.journalEntry.findUniqueOrThrow({ where: { id } });
    if (e.source !== "MANUAL" && e.source !== "OPENING" && e.source !== "DUKAAN") {
      throw new AppError(400, "USE_DOCUMENT", "Void this entry from its invoice, payment or expense");
    }
    await db.$transaction((tx) => voidEntry(tx, id, str(fd, "reason") ?? "Voided"));
    if (e.source === "DUKAAN") return "Voided. It will not be re-posted by the sync (its source reference stays reserved).";
    return "Entry voided";
  }, ACC_PATHS);
}

export async function createAccount(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("accounting.write");
    const type = req(fd, "type") as "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
    await db.account.create({ data: { code: req(fd, "code", "Code"), name: req(fd, "name", "Name"), type, subtype: str(fd, "subtype"), parentId: str(fd, "parentId") } });
    return "Account created";
  }, ["/accounting/accounts"]);
}

export async function toggleAccount(fd: FormData) {
  await requirePermission("accounting.write");
  const a = await db.account.findUniqueOrThrow({ where: { id: req(fd, "id") } });
  if (a.systemKey) return;
  await db.account.update({ where: { id: a.id }, data: { active: !a.active } });
  revalidatePath("/accounting/accounts");
}

// ───────────────────────────── Bank reconciliation ─────────────────────────────

/** CSV columns: date (YYYY-MM-DD or DD/MM/YYYY), description, amount (+ deposit / − withdrawal) [, reference]
 *  or date, description, withdrawal, deposit [, reference] when a "withdrawal" header is present. */
export async function importStatement(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("accounting.write");
    const accountId = req(fd, "accountId", "Bank account");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError(400, "NO_FILE", "Choose a CSV file");
    if (file.size > 2_000_000) throw new AppError(400, "TOO_BIG", "CSV must be under 2 MB");
    const rows = parseStatementCsv(await file.text());
    const batch = `import-${Date.now()}`;
    await db.bankStatementLine.createMany({ data: rows.map((r) => ({ ...r, accountId, importBatch: batch })) });
    return `Imported ${rows.length} statement lines`;
  }, ["/accounting/bank"]);
}

export async function reconcileLine(fd: FormData) {
  await requirePermission("accounting.write");
  const statementId = req(fd, "statementId");
  const journalLineId = str(fd, "journalLineId");
  const st = await db.bankStatementLine.findUniqueOrThrow({ where: { id: statementId } });
  if (journalLineId) {
    const jl = await db.journalLine.findUniqueOrThrow({ where: { id: journalLineId }, include: { entry: true } });
    if (jl.accountId !== st.accountId || jl.entry.voided || jl.debit - jl.credit !== st.amount) throw new Error("That entry does not match this statement line");
  }
  await db.bankStatementLine.update({ where: { id: statementId }, data: { journalLineId } });
  revalidatePath("/accounting/bank");
}

/** Book an unmatched statement line (e.g. bank charges, interest, Cashfree settlement) and reconcile it. */
export async function bookStatementLine(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("accounting.write");
    const st = await db.bankStatementLine.findUniqueOrThrow({ where: { id: req(fd, "statementId") } });
    if (st.journalLineId) throw new AppError(409, "DONE", "Already reconciled");
    const counter = req(fd, "counterAccountId", "Account");
    const { entry } = await post({
      date: st.date,
      narration: `Bank: ${st.description}`,
      createdById: user.id,
      sourceRef: `bank:${st.id}`,
      lines: [
        { accountId: st.accountId, amount: st.amount, memo: st.reference },
        { accountId: counter, amount: -st.amount, partyId: str(fd, "partyId") },
      ],
    });
    const line = await db.journalLine.findFirstOrThrow({ where: { entryId: entry.id, accountId: st.accountId } });
    await db.bankStatementLine.update({ where: { id: st.id }, data: { journalLineId: line.id } });
    return "Booked and reconciled";
  }, ["/accounting/bank", ...ACC_PATHS]);
}

export async function deleteStatementLine(fd: FormData) {
  await requirePermission("accounting.write");
  const st = await db.bankStatementLine.findUniqueOrThrow({ where: { id: req(fd, "statementId") } });
  if (!st.journalLineId) await db.bankStatementLine.delete({ where: { id: st.id } });
  revalidatePath("/accounting/bank");
}
