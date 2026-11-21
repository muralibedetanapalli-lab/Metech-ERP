/**
 * Run one Dukaan → Metech ERP sync from the command line (same as "Sync now" on the Dukaan sync page).
 *   npm run sync:dukaan
 */
import "dotenv/config";
import { runDukaanSync } from "@/server/dukaan/sync";
import { db } from "@/server/db";

runDukaanSync("CLI")
  .then((r) => {
    console.log(r.ok ? "Sync OK" : `Sync failed: ${r.error}`, { parties: r.parties, events: r.events, posted: r.posted, skipped: r.skipped });
    process.exitCode = r.ok ? 0 : 1;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
