import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createInvoice, recordExpense } from "@/server/accounting/documents";
import { trialBalance } from "@/server/accounting/reports";
import { gstr1ForMonth } from "@/server/accounting/gstr1";
import { postDukaanEvent } from "@/server/dukaan/sync";
import { runFeedSync, type FeedFetcher } from "@/server/projects/feed-sync";
import { projectCosting, splitByWeight } from "@/server/projects/costing";
import { syncAllProjects } from "@/server/projects/sync";
import { encryptSecret, decryptSecret } from "@/server/crypto";
import { acc, resetDb } from "./helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const fy = { from: d("2026-04-01"), to: d("2027-03-31") };

/** A fake project app: serves the given parties and events, `pageSize` per page, with numeric cursors. */
function fakeApp(parties: unknown[], events: unknown[], pageSize = 2): FeedFetcher {
  return async (path) => {
    const u = new URL(path, "http://app.test/");
    const list = u.pathname.endsWith("parties") ? parties : events;
    const start = Number(u.searchParams.get("after") ?? 0);
    const items = list.slice(start, start + pageSize);
    return { items, nextCursor: items.length ? String(start + items.length) : null, hasMore: start + items.length < list.length };
  };
}

const PARTIES = [
  { id: "c1", roles: ["CUSTOMER"], name: "Sri Events", gstin: "36AABCM1234F1ZY" },
  { id: "c2", roles: ["CUSTOMER"], name: "Walk-in renter", stateCode: "36" },
  { id: "v1", roles: ["VENDOR"], name: "Canvas Supplies", stateCode: "29" },
];
const line = (rate: number, extra: Record<string, unknown> = {}) => ({ description: "Tent hire", hsnSac: "997319", quantity: 1, rate, taxRateBps: 1800, ...extra });
const EVENTS = [
  { id: "e1", type: "sale.invoice", occurredAt: "2026-11-02T10:00:00Z", data: { number: "TOS/26-27/0001", customerId: "c1", date: "2026-11-02", lines: [line(50_000_00), line(10_000_00, { description: "Lighting" })] } },
  { id: "e2", type: "payment.received", occurredAt: "2026-11-05T10:00:00Z", data: { customerId: "c1", amount: 30_000_00, mode: "UPI", reference: "UTR1", allocations: [{ invoiceNumber: "TOS/26-27/0001", amount: 30_000_00 }] } },
  { id: "e3", type: "sale.credit_note", occurredAt: "2026-11-06T10:00:00Z", data: { number: "TOS-CN/26-27/0001", customerId: "c1", invoiceNumber: "TOS/26-27/0001", reason: "One day less", lines: [line(5_000_00)] } },
  { id: "e4", type: "purchase.bill", occurredAt: "2026-11-07T10:00:00Z", data: { vendorId: "v1", billNumber: "CS-991", lines: [line(20_000_00, { description: "Canvas", hsnSac: "6306" })] } },
  { id: "e5", type: "payment.made", occurredAt: "2026-11-08T10:00:00Z", data: { vendorId: "v1", amount: 23_600_00, allocations: [{ billNumber: "CS-991", amount: 23_600_00 }] } },
  { id: "e6", type: "expense", occurredAt: "2026-11-09T10:00:00Z", data: { amount: 2_000_00, gstRateBps: 1800, description: "Site transport", accountCode: "5330" } },
  { id: "e7", type: "sale.invoice", occurredAt: "2026-11-10T10:00:00Z", data: { number: "TOS/26-27/0002", customerId: "c2", lines: [line(1_000_00)] } },
  { id: "e8", type: "sale.cancelled", occurredAt: "2026-11-11T10:00:00Z", data: { number: "TOS/26-27/0002", reason: "Booking cancelled" } },
];

async function tentos() {
  return db.costCentre.create({ data: { code: "TENTOS", name: "TentOs", kind: "PROJECT", connector: "FEED_V1", baseUrl: "https://tentos.test/feed", apiKeyEnc: encryptSecret("k".repeat(32)), syncEnabled: true } });
}

describe("projects (integration)", () => {
  beforeEach(resetDb);

  it("books a project app's feed once, tagged with the project, keeping the app's invoice numbers", async () => {
    const p = await tentos();
    const r = await runFeedSync(p.id, "TEST", fakeApp(PARTIES, EVENTS));
    expect(r).toMatchObject({ ok: true, parties: 3, events: 8, posted: 8 });

    const inv = await db.invoice.findUniqueOrThrow({ where: { kind_number: { kind: "SALES", number: "TOS/26-27/0001" } } });
    expect(inv).toMatchObject({ costCentreId: p.id, total: 70_800_00, amountPaid: 30_000_00 + 5_900_00, status: "PARTIAL", placeOfSupply: "36" });
    const cn = await db.invoice.findUniqueOrThrow({ where: { kind_number: { kind: "SALES", number: "TOS-CN/26-27/0001" } } });
    expect(cn).toMatchObject({ docType: "CREDIT_NOTE", originalInvoiceId: inv.id, status: "PAID" });
    const bill = await db.invoice.findFirstOrThrow({ where: { kind: "PURCHASE", vendorRef: "CS-991" } });
    expect(bill).toMatchObject({ status: "PAID", igst: 3_600_00, costCentreId: p.id });
    expect(bill.number).toMatch(/^PB\//);
    expect((await db.invoice.findUniqueOrThrow({ where: { kind_number: { kind: "SALES", number: "TOS/26-27/0002" } } })).status).toBe("VOID");
    const party = await db.party.findUniqueOrThrow({ where: { extSource_extType_extId: { extSource: "TENTOS", extType: "PARTY", extId: "c1" } } });
    expect(party).toMatchObject({ isCustomer: true, gstin: "36AABCM1234F1ZY", tags: ["tentos"] });
    expect((await trialBalance(fy.to)).balanced).toBe(true);

    // Revenue 60,000 − 5,000 credit note; direct cost 20,000 canvas + 2,000 transport.
    const c = await projectCosting(fy.from, fy.to);
    expect(c.rows.find((x) => x.code === "TENTOS")).toMatchObject({ revenue: 55_000_00, directCost: 22_000_00, sharedCost: 0, profit: 33_000_00 });

    // Synced sales invoices appear in GSTR-1 under their own numbers.
    const g = (await gstr1ForMonth("2026-11")).json as Record<string, any>;
    expect(g.b2b[0].inv[0].inum).toBe("TOS/26-27/0001");

    // Re-reading from the start books nothing twice.
    await db.syncCursor.deleteMany();
    const again = await runFeedSync(p.id, "TEST", fakeApp(PARTIES, EVENTS));
    expect(again).toMatchObject({ ok: true, events: 8, posted: 0, skipped: 8 });
    expect(await db.invoice.count()).toBe(4);
  });

  it("stops at an event it cannot apply, explains why, and continues once the data is fixed", async () => {
    const p = await tentos();
    const early = [{ id: "x1", type: "payment.received", occurredAt: "2026-11-05T10:00:00Z", data: { customerId: "c1", amount: 100_00, allocations: [{ invoiceNumber: "TOS/99", amount: 100_00 }] } }];
    const r = await runFeedSync(p.id, "TEST", fakeApp(PARTIES, early));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/x1 \(payment.received\).*TOS\/99.*not been received/);
    expect(await db.payment.count()).toBe(0);

    const bad = await runFeedSync(p.id, "TEST", fakeApp([], [{ id: "x2", type: "sale.invoice", occurredAt: "2026-11-05", data: { number: "N1", customerId: "c1", lines: [] } }]));
    expect(bad.error).toMatch(/x2 is not valid: data.lines/);
  });

  it("tags Dukaan postings with the Dukaan project and syncs only configured projects", async () => {
    await postDukaanEvent({ id: "rider_wallet.adjustment:w1", type: "rider_wallet.adjustment", occurredAt: "2026-11-03T10:00:00Z", data: { entryId: "w1", riderId: "r1", amount: 150_00, note: "Fuel" } });
    const dukaan = await db.costCentre.findUniqueOrThrow({ where: { code: "DUKAAN" } });
    expect(dukaan.connector).toBe("DUKAAN");
    const lines = await db.journalLine.findMany();
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.costCentreId === dukaan.id)).toBe(true);
    const c = await projectCosting(fy.from, fy.to);
    expect(c.rows.find((x) => x.code === "DUKAAN")?.directCost).toBe(150_00);
    // Dukaan has no URL/key in tests and TentOs is not created here: nothing to sync, nothing fails.
    expect(await syncAllProjects("TEST")).toEqual([]);
  });

  it("splits shared costs across projects by revenue share", async () => {
    const [a, b] = await Promise.all([
      db.costCentre.create({ data: { code: "A", name: "Project A", kind: "PROJECT" } }),
      db.costCentre.create({ data: { code: "B", name: "Project B", kind: "PROJECT" } }),
    ]);
    const dept = await db.costCentre.create({ data: { code: "ADMIN", name: "Admin", kind: "DEPARTMENT" } });
    const cust = await db.party.create({ data: { kind: "ORGANIZATION", name: "Buyer", stateCode: "36" } });
    const sale = (cc: string, rate: number) => createInvoice({ kind: "SALES", partyId: cust.id, date: d("2026-10-01"), placeOfSupply: "36", costCentreId: cc, lines: [{ description: "Work", quantity: 1, rate, taxRateBps: 1800 }] });
    await sale(a.id, 70_000_00);
    await sale(b.id, 30_000_00);
    const bank = await acc("BANK");
    const salaries = await acc("SALARIES");
    const exp = (amount: number, costCentreId: string | null) => recordExpense({ date: d("2026-10-05"), accountId: salaries.id, paidFromId: bank.id, costCentreId, amount, description: "x" });
    await exp(10_000_00, null); // shared
    await exp(2_000_00, dept.id); // department: shared too
    await exp(5_000_00, a.id); // direct to A

    const c = await projectCosting(fy.from, fy.to);
    expect(c.sharedCost).toBe(12_000_00);
    expect(c.rows.find((x) => x.code === "A")).toMatchObject({ revenue: 70_000_00, directCost: 5_000_00, shareBps: 7000, sharedCost: 8_400_00, totalCost: 13_400_00, profit: 56_600_00 });
    expect(c.rows.find((x) => x.code === "B")).toMatchObject({ revenue: 30_000_00, directCost: 0, sharedCost: 3_600_00, profit: 26_400_00 });
    expect(c.rows.find((x) => x.code === "ADMIN")).toBeUndefined();
  });
});

describe("project helpers", () => {
  it("splits amounts exactly and round-trips secrets", () => {
    expect(splitByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitByWeight(1_000_01, [70, 30]).reduce((s, x) => s + x, 0)).toBe(1_000_01);
    expect(splitByWeight(500, [0, 0])).toEqual([0, 0]);
    const enc = encryptSecret("s3cret-key-value");
    expect(enc).not.toContain("s3cret");
    expect(decryptSecret(enc)).toBe("s3cret-key-value");
  });
});
