import { db } from "@/server/db";
import { ensureChartOfAccounts } from "@/server/accounting/coa";

/** Empty every table (except migrations) and recreate the chart of accounts and company row. */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
  await ensureChartOfAccounts(db);
  await db.companySettings.create({ data: { name: "Metech Solutions", stateCode: "36" } });
}

export const acc = (systemKey: string) => db.account.findUniqueOrThrow({ where: { systemKey } });
