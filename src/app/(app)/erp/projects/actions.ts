"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { req, run, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { encryptSecret } from "@/server/crypto";
import { httpFeedFetcher, resetFeedCursors } from "@/server/projects/feed-sync";
import { syncProject } from "@/server/projects/sync";
import { zFeedPage } from "@/server/projects/feed-contract";
import { parseRupees } from "@/lib/money";
import { dayDate } from "@/lib/dates";
import type { ActionState } from "@/lib/action-state";

const paths = (id: string) => [`/erp/projects/${id}`, "/erp/projects", "/reports", "/"];

export async function updateProject(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = req(fd, "id");
  return run(async () => {
    await requirePermission("erp.write");
    const start = str(fd, "startDate");
    const end = str(fd, "endDate");
    await db.costCentre.update({
      where: { id },
      data: {
        name: req(fd, "name", "Name"),
        kind: str(fd, "kind") ?? "PROJECT",
        description: str(fd, "description"),
        budget: str(fd, "budget") ? parseRupees(fd.get("budget")) : null,
        startDate: start ? dayDate(start) : null,
        endDate: end ? dayDate(end) : null,
        active: fd.get("active") === "on",
      },
    });
    return "Project saved";
  }, paths(id));
}

/** Feed URLs must be HTTPS, except a local development server. */
function checkUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError(400, "BAD_URL", "Feed URL is not a valid URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.hostname.endsWith(".localhost");
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new AppError(400, "BAD_URL", "Feed URL must use https://");
  if (u.username || u.password) throw new AppError(400, "BAD_URL", "Put the key in the API key field, not in the URL");
  return u.toString().replace(/\/$/, "");
}

export async function saveConnection(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = req(fd, "id");
  return run(async () => {
    await requirePermission("admin");
    const p = await db.costCentre.findUniqueOrThrow({ where: { id } });
    if (p.connector === "DUKAAN") {
      await db.costCentre.update({ where: { id }, data: { syncEnabled: fd.get("syncEnabled") === "on" } });
      return "Saved. Dukaan's URL and key are set in the server environment.";
    }
    const connector = str(fd, "connector") === "FEED_V1" ? "FEED_V1" : null;
    if (!connector) {
      await db.costCentre.update({ where: { id }, data: { connector: null, syncEnabled: false } });
      return "Connection removed. Documents already synced stay in the books.";
    }
    if (p.code === "DUKAAN") throw new AppError(400, "RESERVED", "The code DUKAAN is reserved for Dukaan Express");
    const baseUrl = checkUrl(req(fd, "baseUrl", "Feed URL"));
    const key = str(fd, "apiKey");
    if (!key && !p.apiKeyEnc) throw new AppError(400, "NO_KEY", "Enter the API key the app gave you");
    if (key && key.length < 16) throw new AppError(400, "SHORT_KEY", "API key looks too short (16+ characters)");
    const bankAccountId = str(fd, "bankAccountId");
    if (bankAccountId) {
      const a = await db.account.findUnique({ where: { id: bankAccountId } });
      if (!a || !["BANK", "CASH", "CLEARING"].includes(a.subtype ?? "")) throw new AppError(400, "BAD_ACCOUNT", "Choose a bank, cash or clearing account");
    }
    await db.costCentre.update({
      where: { id },
      data: { connector, baseUrl, ...(key ? { apiKeyEnc: encryptSecret(key) } : {}), bankAccountId: bankAccountId ?? null, syncEnabled: fd.get("syncEnabled") === "on", kind: "PROJECT" },
    });
    return "Connection saved";
  }, paths(id));
}

export async function testConnection(id: string): Promise<ActionState> {
  return run(async () => {
    await requirePermission("dukaan.sync");
    const p = await db.costCentre.findUniqueOrThrow({ where: { id } });
    if (p.connector !== "FEED_V1") throw new AppError(400, "NOT_FEED", "Only project-feed connections can be tested here");
    const page = zFeedPage.parse(await httpFeedFetcher(p)("parties?limit=1"));
    return `Connected to ${p.name}: the parties feed answered (${page.items.length ? "has data" : "empty so far"}).`;
  }, paths(id));
}

export async function syncProjectNow(id: string): Promise<ActionState> {
  return run(async () => {
    await requirePermission("dukaan.sync");
    const r = await syncProject(id, "MANUAL");
    if (!r.ok) throw new AppError(502, "SYNC_FAILED", `Sync failed: ${r.error}`);
    return `Synced ${r.parties} contacts and ${r.events} events (${r.posted} booked, ${r.skipped} already booked or no effect)`;
  }, [...paths(id), "/crm/contacts", "/accounting/invoices", "/accounting/journal"]);
}

/** Read the project's feeds again from the start; events already applied are skipped by their id. */
export async function resetFeed(fd: FormData) {
  await requirePermission("admin");
  const id = req(fd, "id");
  await resetFeedCursors(id);
  revalidatePath(`/erp/projects/${id}`);
}
