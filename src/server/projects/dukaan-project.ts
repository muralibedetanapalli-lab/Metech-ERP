import "server-only";
import { db, type DbOrTx } from "@/server/db";

/** The project that Dukaan Express postings belong to (created on first use if the migration's row was removed). */
export async function dukaanProject(tx: DbOrTx = db) {
  const found = await tx.costCentre.findFirst({ where: { connector: "DUKAAN" }, orderBy: { createdAt: "asc" } });
  if (found) return found;
  const byCode = await tx.costCentre.findUnique({ where: { code: "DUKAAN" } });
  if (byCode) return tx.costCentre.update({ where: { id: byCode.id }, data: { connector: "DUKAAN", kind: "PROJECT", syncEnabled: true } });
  return tx.costCentre.create({ data: { code: "DUKAAN", name: "Dukaan Express", kind: "PROJECT", connector: "DUKAAN", syncEnabled: true, description: "Hyperlocal marketplace: commission and delivery margin" } });
}
