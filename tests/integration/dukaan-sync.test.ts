import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { runDukaanSync, type Fetcher } from "@/server/dukaan/sync";
import { accountSums, naturalBalance, trialBalance } from "@/server/accounting/reports";
import type { DukaanEvent, DukaanParty } from "@/server/dukaan/contract";
import { resetDb } from "./helpers";

const party = (p: Partial<DukaanParty> & Pick<DukaanParty, "type" | "id" | "name">): DukaanParty => ({
  email: null,
  phone: null,
  gstin: null,
  address: null,
  city: "Hyderabad",
  state: "Telangana",
  pincode: "500001",
  active: true,
  links: {},
  extra: {},
  adminPath: null,
  updatedAt: "2026-11-20T10:00:00Z",
  ...p,
});

const PARTIES: DukaanParty[] = [
  party({ type: "SHOP", id: "shop1", name: "Sri Sai Kirana", phone: "9000000001", links: { ownerId: "own1", dealerId: "dl1" }, extra: { deliveryMode: "RIDER" }, adminPath: "/admin/shops/shop1" }),
  party({ type: "SHOP_OWNER", id: "own1", name: "Ravi Kumar", phone: "9000000002" }),
  party({ type: "DEALER", id: "dl1", name: "Hyd Dealer" }),
  party({ type: "RIDER", id: "rd1", name: "Rider One" }),
  party({ type: "CUSTOMER", id: "cu1", name: "Priya" }),
];

const EVENTS: DukaanEvent[] = [
  {
    id: "order.delivered:o1",
    type: "order.delivered",
    occurredAt: "2026-11-20T08:00:00Z",
    data: { orderId: "o1", orderNumber: "DX-1001", shopId: "shop1", customerId: "cu1", paymentMethod: "UPI", deliveryMode: "RIDER", riderId: "rd1", total: 57_000, subtotal: 54_000, couponDiscount: 0, deliveryFee: 3_000, taxAmount: 0, commissionAmount: 5_400, shopEarning: 48_600, riderFee: 2_500, codAmount: 0, dealerId: "dl1", dealerAmount: 1_080 },
  },
  {
    id: "order.delivered:o2",
    type: "order.delivered",
    occurredAt: "2026-11-20T09:00:00Z",
    data: { orderId: "o2", orderNumber: "DX-1002", shopId: "shop1", customerId: "cu1", paymentMethod: "COD", deliveryMode: "RIDER", riderId: "rd1", total: 57_000, subtotal: 54_000, couponDiscount: 0, deliveryFee: 3_000, taxAmount: 0, commissionAmount: 5_400, shopEarning: 48_600, riderFee: 2_500, codAmount: 57_000, dealerId: null, dealerAmount: 0 },
  },
  { id: "refund.processed:rf0", type: "refund.processed", occurredAt: "2026-11-20T09:30:00Z", data: { refundId: "rf0", orderId: "o9", orderNumber: "DX-1009", customerId: "cu1", amount: 10_000, paymentMethod: "UPI", orderDelivered: false } },
  { id: "shop_settlement.paid:st1", type: "shop_settlement.paid", occurredAt: "2026-11-21T06:00:00Z", data: { settlementId: "st1", shopId: "shop1", amount: 97_200, orderCount: 2, reference: "UTR1", method: "IMPS" } },
  { id: "dealer_payout.paid:dp1", type: "dealer_payout.paid", occurredAt: "2026-11-21T06:00:00Z", data: { payoutId: "dp1", dealerId: "dl1", amount: 1_080, orderCount: 1, reference: null, method: "UPI" } },
];

/** A fake Dukaan server: serves the arrays in pages of `pageSize`, cursor = index. */
function fakeDukaan(parties: DukaanParty[], events: DukaanEvent[], pageSize = 2): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (path: string) => {
    calls.push(path);
    const url = new URL(path, "http://dukaan.test");
    const list = url.pathname.endsWith("/parties") ? parties : events;
    const start = Number(url.searchParams.get("after") ?? 0);
    const items = list.slice(start, start + pageSize);
    return { items, nextCursor: String(start + items.length), hasMore: start + items.length < list.length };
  }) as Fetcher & { calls: string[] };
  f.calls = calls;
  return f;
}

const balance = async (code: string) => {
  const a = (await accountSums({})).find((s) => s.code === code)!;
  return naturalBalance(a);
};

describe("Dukaan sync (integration)", () => {
  beforeEach(resetDb);

  it("creates CRM contacts, posts each money event once and keeps the books balanced", async () => {
    const r = await runDukaanSync("TEST", fakeDukaan(PARTIES, EVENTS));
    expect(r).toMatchObject({ ok: true, parties: 5, events: 5, posted: 4, skipped: 1 });

    const shop = await db.party.findUniqueOrThrow({ where: { extSource_extType_extId: { extSource: "DUKAAN", extType: "SHOP", extId: "shop1" } } });
    expect(shop).toMatchObject({ kind: "ORGANIZATION", name: "Sri Sai Kirana", stateCode: "36", isCustomer: true, isVendor: true });
    expect(shop.tags).toEqual(expect.arrayContaining(["dukaan", "dukaan-shop"]));
    const owner = await db.party.findUniqueOrThrow({ where: { extSource_extType_extId: { extSource: "DUKAAN", extType: "SHOP_OWNER", extId: "own1" } } });
    expect(owner.orgId).toBe(shop.id);

    expect((await trialBalance(new Date("2027-01-01"))).balanced).toBe(true);
    expect(await balance("1400")).toBe(57_000); // online collection in Cashfree clearing
    expect(await balance("2300")).toBe(0); // 2 × 48,600 earned − 97,200 settled
    expect(await balance("2310")).toBe(-57_000 + 2 * 2_500); // rider holds COD cash: owes Metech 52,000
    expect(await balance("2320")).toBe(0); // dealer share accrued and paid
    expect(await balance("4100")).toBe(10_800); // commission
    expect(await balance("4110")).toBe(1_000); // 2 × (3,000 fee − 2,500 rider)

    // Cursors were saved, so a second run asks only for what comes after them and posts nothing new.
    const again = await runDukaanSync("TEST", fakeDukaan(PARTIES, EVENTS));
    expect(again).toMatchObject({ ok: true, parties: 0, events: 0, posted: 0 });
    expect(await db.journalEntry.count({ where: { source: "DUKAAN" } })).toBe(4);
  });

  it("is idempotent when Dukaan re-sends events, and keeps CRM edits on re-sync", async () => {
    await runDukaanSync("TEST", fakeDukaan(PARTIES, EVENTS));
    const shop = await db.party.findFirstOrThrow({ where: { extType: "SHOP" } });
    await db.party.update({ where: { id: shop.id }, data: { tags: [...shop.tags, "key-account"], notes: "Prefers WhatsApp" } });
    await db.syncCursor.deleteMany();
    const renamed = PARTIES.map((p) => (p.id === "shop1" ? { ...p, name: "Sri Sai Super Market" } : p));
    const r = await runDukaanSync("TEST", fakeDukaan(renamed, EVENTS));
    expect(r).toMatchObject({ ok: true, posted: 0, skipped: 5 });
    const after = await db.party.findUniqueOrThrow({ where: { id: shop.id } });
    expect(after).toMatchObject({ name: "Sri Sai Super Market", notes: "Prefers WhatsApp" });
    expect(after.tags).toContain("key-account");
  });

  it("creates placeholder parties for events that arrive before their records and records failures", async () => {
    const r = await runDukaanSync("TEST", fakeDukaan([], [EVENTS[3]]));
    expect(r.posted).toBe(1);
    expect(await db.party.count({ where: { extType: "SHOP", extId: "shop1" } })).toBe(1);

    const failing: Fetcher = async () => {
      throw new Error("Dukaan API 401: Invalid API key");
    };
    const bad = await runDukaanSync("TEST", failing);
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("401") });
    expect((await db.syncRun.findFirstOrThrow({ where: { id: bad.runId } })).finishedAt).not.toBeNull();
  });
});
