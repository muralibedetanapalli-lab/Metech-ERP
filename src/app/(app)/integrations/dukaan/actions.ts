"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { req, run, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { dukaanConfigured, runDukaanSync } from "@/server/dukaan/sync";
import type { ActionState } from "@/lib/action-state";

const PATHS = ["/integrations/dukaan", "/", "/crm/contacts", "/accounting/journal", "/reports"];

export async function syncNow(): Promise<ActionState> {
  return run(async () => {
    await requirePermission("dukaan.sync");
    if (!dukaanConfigured()) throw new AppError(400, "NOT_CONFIGURED", "Set DUKAAN_BASE_URL and DUKAAN_API_KEY in the server environment first");
    const r = await runDukaanSync("MANUAL");
    if (!r.ok) throw new AppError(502, "SYNC_FAILED", `Sync failed: ${r.error}`);
    return `Synced ${r.parties} contacts and ${r.events} money events (${r.posted} posted, ${r.skipped} already posted or no effect)`;
  }, PATHS);
}

export async function saveDukaanSettings(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("admin");
    const bps = Number(str(fd, "commissionGstBps") ?? 0);
    if (!Number.isInteger(bps) || bps < 0 || bps > 2800) throw new AppError(400, "GST", "Commission GST must be 0–28%");
    await db.companySettings.upsert({
      where: { id: "company" },
      create: { commissionGstBps: bps, dukaanPayoutAccountId: str(fd, "dukaanPayoutAccountId") },
      update: { commissionGstBps: bps, dukaanPayoutAccountId: str(fd, "dukaanPayoutAccountId") },
    });
    return "Settings saved. They apply to entries posted from now on.";
  }, PATHS);
}

/** Start the event feed again from the beginning (already-posted events are skipped by their source reference). */
export async function resetCursor(fd: FormData) {
  await requirePermission("admin");
  const feed = req(fd, "feed");
  await db.syncCursor.deleteMany({ where: { feed } });
  revalidatePath("/integrations/dukaan");
}
