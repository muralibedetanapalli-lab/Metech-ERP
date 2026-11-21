import { describe, expect, it } from "vitest";
import { istDay, mapEvent, type MapContext } from "@/server/dukaan/mapping";
import type { DukaanEvent } from "@/server/dukaan/contract";
import type { LineInput } from "@/server/accounting/ledger";

const ctx: MapContext = { party: (t, id) => `${t}:${id}`, commissionGstBps: 0, payoutAccountId: "BANK_ACC" };
const net = (lines: LineInput[]) => lines.reduce((s, l) => s + (l.amount ?? 0), 0);
const byKey = (lines: LineInput[], key: string) => lines.filter((l) => l.key === key).reduce((s, l) => s + (l.amount ?? 0), 0);

// ₹540 of items, 10% commission (₹54), ₹30 delivery fee charged, rider earns ₹25.
const base = {
  orderId: "o1",
  orderNumber: "DX-1",
  shopId: "s1",
  customerId: "c1",
  total: 57_000,
  subtotal: 54_000,
  couponDiscount: 0,
  deliveryFee: 3_000,
  taxAmount: 0,
  commissionAmount: 5_400,
  dealerId: null,
  dealerAmount: 0,
};
const order = (d: Partial<Extract<DukaanEvent, { type: "order.delivered" }>["data"]>): DukaanEvent => ({
  id: "order.delivered:o1",
  type: "order.delivered",
  occurredAt: "2026-11-20T20:00:00.000Z",
  data: { ...base, paymentMethod: "UPI", deliveryMode: "RIDER", riderId: "r1", shopEarning: 48_600, riderFee: 2_500, codAmount: 0, ...d },
});

describe("Dukaan event → journal mapping", () => {
  it("online order with a Dukaan rider: gateway in, shop + rider payable, commission and delivery margin", () => {
    const m = mapEvent(order({}), ctx)!;
    expect(net(m.lines)).toBe(0);
    expect(m.sourceRef).toBe("dukaan:order.delivered:o1");
    expect(byKey(m.lines, "CASHFREE_CLEARING")).toBe(57_000);
    expect(byKey(m.lines, "DUKAAN_SHOP_PAYABLE")).toBe(-48_600);
    expect(byKey(m.lines, "DUKAAN_RIDER_PAYABLE")).toBe(-2_500);
    expect(byKey(m.lines, "DUKAAN_COMMISSION")).toBe(-5_400);
    expect(byKey(m.lines, "DUKAAN_DELIVERY_INCOME")).toBe(-500);
    // 01:30 IST on 21 Nov is booked on 21 Nov.
    expect(m.date.toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  it("COD collected by the rider is netted on the rider wallet", () => {
    const m = mapEvent(order({ paymentMethod: "COD", codAmount: 57_000 }), ctx)!;
    expect(net(m.lines)).toBe(0);
    expect(byKey(m.lines, "CASHFREE_CLEARING")).toBe(0);
    // +57,000 cash held − 2,500 fee earned = rider owes 54,500 (matches the Dukaan wallet).
    expect(byKey(m.lines, "DUKAAN_RIDER_PAYABLE")).toBe(54_500);
  });

  it("COD with the shop's own delivery: shop already holds the cash, owes the commission", () => {
    // Dukaan: shopEarning = earning + fee − total = 48,600 + 3,000 − 57,000 = −5,400
    const m = mapEvent(order({ paymentMethod: "COD", deliveryMode: "OWN", riderId: null, riderFee: 0, codAmount: 57_000, shopEarning: -5_400 }), ctx)!;
    expect(net(m.lines)).toBe(0);
    expect(byKey(m.lines, "DUKAAN_SHOP_PAYABLE")).toBe(5_400); // debit: receivable from the shop
    expect(byKey(m.lines, "DUKAAN_COMMISSION")).toBe(-5_400);
    expect(m.lines.some((l) => l.key === "DUKAAN_DELIVERY_INCOME" || l.key === "DUKAAN_DELIVERY_COST")).toBe(false);
  });

  it("free delivery that still pays a rider is a delivery cost; dealer share is expensed", () => {
    const m = mapEvent(order({ total: 54_000, deliveryFee: 0, dealerId: "d1", dealerAmount: 1_080 }), ctx)!;
    expect(net(m.lines)).toBe(0);
    expect(byKey(m.lines, "DUKAAN_DELIVERY_COST")).toBe(2_500);
    expect(byKey(m.lines, "DUKAAN_DEALER_COMMISSION")).toBe(1_080);
    expect(byKey(m.lines, "DUKAAN_DEALER_PAYABLE")).toBe(-1_080);
    expect(m.lines.find((l) => l.key === "DUKAAN_DEALER_PAYABLE")?.partyId).toBe("DEALER:d1");
  });

  it("splits GST out of the commission when configured", () => {
    const m = mapEvent(order({ commissionAmount: 5_900 , shopEarning: 48_100 }), { ...ctx, commissionGstBps: 1800 })!;
    expect(net(m.lines)).toBe(0);
    expect(byKey(m.lines, "DUKAAN_COMMISSION")).toBe(-5_000);
    expect(byKey(m.lines, "OUTPUT_CGST") + byKey(m.lines, "OUTPUT_SGST")).toBe(-900);
  });

  it("payouts debit the payable and credit the payout bank", () => {
    const m = mapEvent({ id: "shop_settlement.paid:x", type: "shop_settlement.paid", occurredAt: "2026-11-20T06:00:00Z", data: { settlementId: "x", shopId: "s1", amount: 48_600, orderCount: 1, reference: "UTR9", method: "IMPS" } }, ctx)!;
    expect(m.lines).toEqual([
      { key: "DUKAAN_SHOP_PAYABLE", amount: 48_600, partyId: "SHOP:s1", memo: "Payout" },
      { accountId: "BANK_ACC", amount: -48_600, partyId: "SHOP:s1", memo: "Payout" },
    ]);
    expect(m.narration).toContain("UTR9");
    const r = mapEvent({ id: "rider_withdrawal.paid:w", type: "rider_withdrawal.paid", occurredAt: "2026-11-20T06:00:00Z", data: { withdrawalId: "w", riderId: "r1", amount: 1_000, reference: null, method: null } }, ctx)!;
    expect(byKey(r.lines, "DUKAAN_RIDER_PAYABLE")).toBe(1_000);
  });

  it("refunds only matter for delivered orders", () => {
    const ev = (orderDelivered: boolean): DukaanEvent => ({ id: "refund.processed:f", type: "refund.processed", occurredAt: "2026-11-20T06:00:00Z", data: { refundId: "f", orderId: "o1", orderNumber: "DX-1", customerId: "c1", amount: 2_000, paymentMethod: "UPI", orderDelivered } });
    expect(mapEvent(ev(false), ctx)).toBeNull();
    const m = mapEvent(ev(true), ctx)!;
    expect(byKey(m.lines, "DUKAAN_REFUNDS")).toBe(2_000);
    expect(byKey(m.lines, "CASHFREE_CLEARING")).toBe(-2_000);
    expect(mapEvent(ev(true), { ...ctx, orderPosted: () => false })).toBeNull();
  });

  it("books by IST calendar day", () => {
    expect(istDay("2026-11-20T18:29:00Z").toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(istDay("2026-11-20T18:31:00Z").toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });
});
