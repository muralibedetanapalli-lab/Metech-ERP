import "server-only";
import type { DbOrTx } from "@/server/db";
import type { AccountType } from "@/generated/prisma/client";
import { SYSTEM_ACCOUNTS, type SystemKey } from "./coa-data";

export { SYSTEM_ACCOUNTS, type SystemKey };


/** Create any missing system accounts (idempotent). */
export async function ensureChartOfAccounts(tx: DbOrTx) {
  for (const [key, a] of Object.entries(SYSTEM_ACCOUNTS)) {
    await tx.account.upsert({
      where: { systemKey: key },
      create: { systemKey: key, code: a.code, name: a.name, type: a.type, subtype: a.subtype },
      update: {},
    });
  }
}

/** Account id for a system key. Creates the chart if it is missing. */
export async function systemAccountId(tx: DbOrTx, key: SystemKey): Promise<string> {
  let acc = await tx.account.findUnique({ where: { systemKey: key }, select: { id: true } });
  if (!acc) {
    await ensureChartOfAccounts(tx);
    acc = await tx.account.findUniqueOrThrow({ where: { systemKey: key }, select: { id: true } });
  }
  return acc.id;
}

/** Debit-normal account types: balance = debit − credit. Others: credit − debit. */
export const isDebitNormal = (type: AccountType) => type === "ASSET" || type === "EXPENSE";
