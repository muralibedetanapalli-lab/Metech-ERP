import "server-only";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { stateCodeFromName } from "@/lib/gst";
import { postEntry } from "@/server/accounting/ledger";
import { systemAccountId } from "@/server/accounting/coa";
import type { DukaanEvent, DukaanParty, DukaanPartyType, FeedPage } from "./contract";
import { mapEvent, sourceRefFor } from "./mapping";

const SOURCE = "DUKAAN";
const PAGE_SIZE = 200;
const MAX_PAGES = 50; // per feed per run; the next run continues from the saved cursor

export type Fetcher = (path: string) => Promise<unknown>;

export function dukaanConfigured() {
  const e = env();
  return Boolean(e.DUKAAN_BASE_URL && e.DUKAAN_API_KEY);
}

/** Server-to-server GET against the Dukaan integration API with the service key. */
export const httpFetcher: Fetcher = async (path) => {
  const e = env();
  if (!e.DUKAAN_BASE_URL || !e.DUKAAN_API_KEY) throw new Error("Dukaan integration is not configured (DUKAAN_BASE_URL, DUKAAN_API_KEY)");
  const res = await fetch(new URL(path, e.DUKAAN_BASE_URL), {
    headers: { Authorization: `Bearer ${e.DUKAAN_API_KEY}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`Dukaan API ${res.status}: ${body?.error?.message ?? res.statusText}`);
  return body?.data;
};

async function getCursor(feed: string) {
  return (await db.syncCursor.findUnique({ where: { feed } }))?.cursor ?? null;
}
async function setCursor(feed: string, cursor: string | null) {
  await db.syncCursor.upsert({ where: { feed }, create: { feed, cursor }, update: { cursor } });
}

const PARTY_LABEL: Record<DukaanPartyType, string> = { SHOP: "Shop", SHOP_OWNER: "Shop owner", DEALER: "Dealer", RIDER: "Rider", CUSTOMER: "Customer" };

/** Insert or update the CRM party for a Dukaan record. */
export async function upsertParty(tx: Tx | typeof db, p: DukaanParty) {
  const kind = p.type === "SHOP" ? "ORGANIZATION" : "PERSON";
  const stateCode = (p.gstin && /^\d{2}/.test(p.gstin) ? p.gstin.slice(0, 2) : null) ?? stateCodeFromName(p.state);
  const tag = `dukaan-${p.type.toLowerCase().replace("_", "-")}`;
  const data = {
    kind,
    name: p.name || `${PARTY_LABEL[p.type]} ${p.id.slice(-6)}`,
    email: p.email,
    phone: p.phone,
    gstin: p.gstin,
    stateCode,
    address: p.address,
    city: p.city,
    pincode: p.pincode,
    // Shops are Metech's customers (commission) and its payees (settlements); riders and dealers are payees.
    isCustomer: p.type === "SHOP" || p.type === "CUSTOMER",
    isVendor: p.type === "SHOP" || p.type === "RIDER" || p.type === "DEALER",
    archived: !p.active,
    extData: { ...p.extra, links: p.links, adminPath: p.adminPath } as object,
    extSyncedAt: new Date(),
  } as const;
  const existing = await tx.party.findUnique({ where: { extSource_extType_extId: { extSource: SOURCE, extType: p.type, extId: p.id } } });
  if (existing) {
    // Keep tags and notes added in the CRM; refresh Dukaan-owned fields.
    return tx.party.update({ where: { id: existing.id }, data: { ...data, tags: Array.from(new Set([...existing.tags, "dukaan", tag])) } });
  }
  return tx.party.create({ data: { ...data, tags: ["dukaan", tag], extSource: SOURCE, extType: p.type, extId: p.id } });
}

/** Link shop-owner contacts to their shop organisation, once both exist. */
async function linkOwners(parties: DukaanParty[]) {
  for (const p of parties) {
    if (p.type !== "SHOP" || !p.links.ownerId) continue;
    const [shop, owner] = await Promise.all([
      db.party.findUnique({ where: { extSource_extType_extId: { extSource: SOURCE, extType: "SHOP", extId: p.id } }, select: { id: true } }),
      db.party.findUnique({ where: { extSource_extType_extId: { extSource: SOURCE, extType: "SHOP_OWNER", extId: p.links.ownerId } }, select: { id: true, orgId: true } }),
    ]);
    if (shop && owner && !owner.orgId) await db.party.update({ where: { id: owner.id }, data: { orgId: shop.id } });
  }
}

/** Find (or create a placeholder for) the party behind a Dukaan id used in a money event. */
async function partyId(tx: Tx, type: DukaanPartyType, id: string) {
  const key = { extSource_extType_extId: { extSource: SOURCE, extType: type, extId: id } };
  const found = await tx.party.findUnique({ where: key, select: { id: true } });
  if (found) return found.id;
  const created = await tx.party.create({
    data: { kind: type === "SHOP" ? "ORGANIZATION" : "PERSON", name: `${PARTY_LABEL[type]} ${id.slice(-6)}`, extSource: SOURCE, extType: type, extId: id, tags: ["dukaan"] },
  });
  return created.id;
}

/** Post one event in its own transaction. Returns "posted" | "skipped" | "duplicate". */
export async function postDukaanEvent(e: DukaanEvent): Promise<"posted" | "skipped" | "duplicate"> {
  return db.$transaction(async (tx) => {
    const ref = sourceRefFor(e);
    if (await tx.journalEntry.findUnique({ where: { sourceRef: ref }, select: { id: true } })) return "duplicate";
    const company = await tx.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} });
    const payoutAccountId = company.dukaanPayoutAccountId ?? (await systemAccountId(tx, "BANK"));
    // Resolve every referenced party first so the (synchronous) mapper can look them up.
    const ids = new Map<string, string>();
    const need: [DukaanPartyType, string | null | undefined][] = [];
    if (e.type === "order.delivered") need.push(["SHOP", e.data.shopId], ["CUSTOMER", e.data.customerId], ["RIDER", e.data.riderId], ["DEALER", e.data.dealerId]);
    if (e.type === "refund.processed") need.push(["CUSTOMER", e.data.customerId]);
    if (e.type === "shop_settlement.paid") need.push(["SHOP", e.data.shopId]);
    if (e.type === "dealer_payout.paid") need.push(["DEALER", e.data.dealerId]);
    if (e.type === "rider_withdrawal.paid" || e.type === "rider_wallet.adjustment") need.push(["RIDER", e.data.riderId]);
    for (const [t, id] of need) if (id) ids.set(`${t}:${id}`, await partyId(tx, t, id));
    let orderPosted = true;
    if (e.type === "refund.processed") {
      orderPosted = Boolean(await tx.journalEntry.findUnique({ where: { sourceRef: `dukaan:order.delivered:${e.data.orderId}` }, select: { id: true } }));
    }
    const mapped = mapEvent(e, {
      party: (t, id) => ids.get(`${t}:${id}`)!,
      commissionGstBps: company.commissionGstBps,
      payoutAccountId,
      orderPosted: () => orderPosted,
    });
    if (!mapped) return "skipped";
    const { created } = await postEntry(tx, { ...mapped, source: "DUKAAN" });
    return created ? "posted" : "duplicate";
  });
}

export interface SyncResult {
  runId: string;
  ok: boolean;
  parties: number;
  events: number;
  posted: number;
  skipped: number;
  error?: string;
}

/**
 * Pull changed parties, then money events, from Dukaan and apply them. Safe to run repeatedly:
 * parties are upserts and every event posts at most one journal entry (keyed by its sourceRef).
 */
export async function runDukaanSync(trigger: "MANUAL" | "CRON" | "CLI" | "TEST", fetcher: Fetcher = httpFetcher): Promise<SyncResult> {
  // Pooled connections make session advisory locks unreliable, so an unfinished recent run acts as the lock.
  const running = await db.syncRun.findFirst({ where: { finishedAt: null, startedAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (running) throw new Error("A Dukaan sync is already running");
  const run = await db.syncRun.create({ data: { trigger } });
  const result: SyncResult = { runId: run.id, ok: false, parties: 0, events: 0, posted: 0, skipped: 0 };
  try {
    // 1. Parties → CRM contacts and companies
    let cursor = await getCursor("parties");
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = (await fetcher(`/api/v1/integrations/erp/parties?limit=${PAGE_SIZE}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`)) as FeedPage<DukaanParty>;
      for (const p of page.items) await upsertParty(db, p);
      await linkOwners(page.items);
      result.parties += page.items.length;
      if (page.nextCursor) {
        cursor = page.nextCursor;
        await setCursor("parties", cursor);
      }
      if (!page.hasMore) break;
    }
    // 2. Money events → journal entries
    cursor = await getCursor("events");
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = (await fetcher(`/api/v1/integrations/erp/events?limit=${PAGE_SIZE}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`)) as FeedPage<DukaanEvent>;
      for (const e of page.items) {
        const r = await postDukaanEvent(e);
        result.events++;
        if (r === "posted") result.posted++;
        else result.skipped++;
      }
      if (page.nextCursor) {
        cursor = page.nextCursor;
        await setCursor("events", cursor);
      }
      if (!page.hasMore) break;
    }
    result.ok = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    await db.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: result.ok, parties: result.parties, events: result.events, posted: result.posted, skipped: result.skipped, error: result.error?.slice(0, 1000) ?? null },
    });
  }
  return result;
}

/** Link from an ERP record to the Dukaan admin panel. */
export function dukaanAdminUrl(path: string | null | undefined) {
  const base = env().DUKAAN_BASE_URL;
  if (!base || !path) return null;
  return new URL(path, base).toString();
}
