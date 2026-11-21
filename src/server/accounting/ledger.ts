import "server-only";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import type { EntrySource } from "@/generated/prisma/client";
import { systemAccountId, type SystemKey } from "./coa";

/** Indian financial year label for a date, e.g. 2026-11-21 → "2026-27" (FY starts in April by default). */
export function fiscalYear(date: Date, startMonth = 4): string {
  const y = date.getFullYear();
  const start = date.getMonth() + 1 >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Gap-free running number per prefix and financial year, e.g. "JV/2026-27/0001". */
export async function nextNumber(tx: DbOrTx, prefix: string, date = new Date()): Promise<string> {
  const fy = fiscalYear(date);
  const key = `${prefix}/${fy}`;
  const seq = await tx.sequence.upsert({ where: { key }, create: { key, next: 2 }, update: { next: { increment: 1 } } });
  const n = seq.next - 1;
  return `${key}/${String(n).padStart(4, "0")}`;
}

export interface LineInput {
  /** Account id, or a system account key. */
  accountId?: string;
  key?: SystemKey;
  /** Signed amount in paise: positive = debit, negative = credit. Use instead of debit/credit. */
  amount?: number;
  debit?: number;
  credit?: number;
  partyId?: string | null;
  costCentreId?: string | null;
  memo?: string | null;
}

export interface EntryInput {
  date: Date;
  narration: string;
  source?: EntrySource;
  sourceRef?: string | null;
  createdById?: string | null;
  lines: LineInput[];
}

export interface NormalizedLine {
  accountId: string;
  debit: number;
  credit: number;
  partyId: string | null;
  costCentreId: string | null;
  memo: string | null;
}

/** Turn signed / mixed lines into one-sided debit or credit lines; drops zero lines. Pure apart from account lookup. */
export async function normalizeLines(tx: DbOrTx, lines: LineInput[]): Promise<NormalizedLine[]> {
  const out: NormalizedLine[] = [];
  for (const l of lines) {
    const net = (l.amount ?? 0) + (l.debit ?? 0) - (l.credit ?? 0);
    if (!Number.isInteger(net)) throw new AppError(400, "BAD_AMOUNT", "Amounts must be whole paise");
    if (net === 0) continue;
    const accountId = l.accountId ?? (l.key ? await systemAccountId(tx, l.key) : undefined);
    if (!accountId) throw new AppError(400, "NO_ACCOUNT", "Every journal line needs an account");
    out.push({
      accountId,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
      partyId: l.partyId ?? null,
      costCentreId: l.costCentreId ?? null,
      memo: l.memo ?? null,
    });
  }
  return out;
}

export function assertBalanced(lines: { debit: number; credit: number }[]) {
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (lines.length < 2) throw new AppError(400, "TOO_FEW_LINES", "A journal entry needs at least two lines");
  if (dr !== cr) throw new AppError(400, "UNBALANCED", `Debits (${dr / 100}) and credits (${cr / 100}) must be equal`);
  if (dr === 0) throw new AppError(400, "ZERO_ENTRY", "A journal entry cannot be zero");
}

/**
 * Post a balanced journal entry. With a sourceRef the call is idempotent: posting the same
 * sourceRef twice returns the existing entry instead of creating a duplicate.
 */
export async function postEntry(tx: Tx, input: EntryInput) {
  if (input.sourceRef) {
    const existing = await tx.journalEntry.findUnique({ where: { sourceRef: input.sourceRef } });
    if (existing) return { entry: existing, created: false };
  }
  const lines = await normalizeLines(tx, input.lines);
  assertBalanced(lines);
  const number = await nextNumber(tx, "JV", input.date);
  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: input.date,
      narration: input.narration.slice(0, 500),
      source: input.source ?? "MANUAL",
      sourceRef: input.sourceRef ?? null,
      createdById: input.createdById ?? null,
      lines: { create: lines },
    },
  });
  return { entry, created: true };
}

/** Convenience wrapper that opens its own transaction. */
export function post(input: EntryInput) {
  return db.$transaction((tx) => postEntry(tx, input));
}

/** Voiding keeps the entry for the audit trail but excludes it from every report. */
export async function voidEntry(tx: Tx, entryId: string, reason: string) {
  const e = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: { include: { reconciledWith: true } } } });
  if (e.voided) return e;
  if (e.lines.some((l) => l.reconciledWith)) {
    throw new AppError(409, "RECONCILED", "Un-reconcile the bank lines of this entry before voiding it");
  }
  return tx.journalEntry.update({ where: { id: entryId }, data: { voided: true, voidReason: reason.slice(0, 300) } });
}
