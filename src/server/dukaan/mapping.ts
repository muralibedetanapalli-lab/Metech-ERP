import type { LineInput } from "@/server/accounting/ledger";
import type { DukaanEvent, DukaanPartyType } from "./contract";

export interface MapContext {
  /** ERP party id for a Dukaan record (created on demand by the caller). */
  party: (type: DukaanPartyType, id: string) => string;
  /** GST rate charged on platform commission, in bps (0 = none). */
  commissionGstBps: number;
  /** Bank/cash account that pays Dukaan payouts. */
  payoutAccountId: string;
  /** True when this order's delivery was posted, so a refund reverses real revenue. */
  orderPosted?: (orderId: string) => boolean;
}

export interface MappedEntry {
  date: Date;
  narration: string;
  sourceRef: string;
  lines: LineInput[];
}

/** Books are kept by Indian calendar day: a timestamp becomes UTC midnight of its IST date (like dates typed in forms). */
export function istDay(ts: string | Date): Date {
  const ist = new Date(new Date(ts).getTime() + 330 * 60_000);
  return new Date(`${ist.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export const sourceRefFor =(e: Pick<DukaanEvent, "id">) => `dukaan:${e.id}`;

/**
 * Turn one Dukaan money event into a balanced journal entry in Metech's books (Metech runs the marketplace
 * as an agent: shop sales are not Metech revenue; commission and delivery margin are). Returns null when the
 * event has no accounting effect.
 *
 * Delivered order (signed amounts, + = debit):
 *   + cash in       Cashfree clearing (online) | rider wallet (COD, Dukaan rider) | nothing (COD, shop delivers: netted in shopEarning)
 *   − shopEarning   payable to shop
 *   − riderFee      rider wallet
 *   − commission    platform commission (less output GST when configured)
 *   ± residual      delivery fees & marketplace income (+) or delivery cost (−)
 *   ± dealer share  dealer commission expense / dealer payable
 */
export function mapEvent(e: DukaanEvent, ctx: MapContext): MappedEntry | null {
  const date = istDay(e.occurredAt);
  const sourceRef = sourceRefFor(e);
  switch (e.type) {
    case "order.delivered": {
      const d = e.data;
      const shop = ctx.party("SHOP", d.shopId);
      const customer = ctx.party("CUSTOMER", d.customerId);
      const rider = d.riderId ? ctx.party("RIDER", d.riderId) : null;
      const riderCollectsCash = d.paymentMethod === "COD" && d.deliveryMode === "RIDER" && rider;
      const cashIn = d.paymentMethod !== "COD" ? d.total : riderCollectsCash ? d.codAmount : 0;
      const riderFee = rider ? d.riderFee : 0;
      const lines: LineInput[] = [];
      if (d.paymentMethod !== "COD") lines.push({ key: "CASHFREE_CLEARING", amount: cashIn, partyId: customer, memo: `${d.paymentMethod} collection` });
      else if (riderCollectsCash) lines.push({ key: "DUKAAN_RIDER_PAYABLE", amount: cashIn, partyId: rider, memo: "COD cash collected by rider" });
      lines.push({ key: "DUKAAN_SHOP_PAYABLE", amount: -d.shopEarning, partyId: shop, memo: "Shop earning" });
      if (riderFee) lines.push({ key: "DUKAAN_RIDER_PAYABLE", amount: -riderFee, partyId: rider, memo: "Delivery earning" });

      const commissionTax = ctx.commissionGstBps > 0 ? d.commissionAmount - Math.round((d.commissionAmount * 10_000) / (10_000 + ctx.commissionGstBps)) : 0;
      lines.push({ key: "DUKAAN_COMMISSION", amount: -(d.commissionAmount - commissionTax), partyId: shop, memo: "Platform commission" });
      if (commissionTax) {
        const cgst = Math.floor(commissionTax / 2);
        lines.push({ key: "OUTPUT_CGST", amount: -cgst, memo: "GST on commission" }, { key: "OUTPUT_SGST", amount: -(commissionTax - cgst), memo: "GST on commission" });
      }
      const residual = cashIn - d.shopEarning - riderFee - d.commissionAmount;
      if (residual > 0) lines.push({ key: "DUKAAN_DELIVERY_INCOME", amount: -residual, partyId: customer, memo: "Delivery fee / marketplace margin" });
      if (residual < 0) lines.push({ key: "DUKAAN_DELIVERY_COST", amount: -residual, memo: "Delivery cost / marketplace adjustment" });
      if (d.dealerId && d.dealerAmount) {
        const dealer = ctx.party("DEALER", d.dealerId);
        lines.push({ key: "DUKAAN_DEALER_COMMISSION", amount: d.dealerAmount, partyId: dealer, memo: "Dealer commission share" });
        lines.push({ key: "DUKAAN_DEALER_PAYABLE", amount: -d.dealerAmount, partyId: dealer, memo: "Dealer commission share" });
      }
      return { date, sourceRef, narration: `Dukaan order ${d.orderNumber} delivered (${d.paymentMethod}${d.deliveryMode ? `, ${d.deliveryMode}` : ""})`, lines };
    }
    case "refund.processed": {
      const d = e.data;
      // Refunds of orders that were never delivered only reverse the gateway collection, which was never booked.
      if (!d.orderDelivered || (ctx.orderPosted && !ctx.orderPosted(d.orderId))) return null;
      const customer = ctx.party("CUSTOMER", d.customerId);
      const from = d.paymentMethod === "COD" ? { accountId: ctx.payoutAccountId } : { key: "CASHFREE_CLEARING" as const };
      return {
        date,
        sourceRef,
        narration: `Dukaan refund on delivered order ${d.orderNumber}`,
        lines: [
          { key: "DUKAAN_REFUNDS", amount: d.amount, partyId: customer, memo: "Customer refund" },
          { ...from, amount: -d.amount, partyId: customer, memo: "Customer refund" },
        ],
      };
    }
    case "shop_settlement.paid":
      return payout(date, sourceRef, ctx, "DUKAAN_SHOP_PAYABLE", ctx.party("SHOP", e.data.shopId), e.data.amount, `Dukaan shop settlement paid (${e.data.orderCount} orders)${ref(e.data.reference)}`);
    case "dealer_payout.paid":
      return payout(date, sourceRef, ctx, "DUKAAN_DEALER_PAYABLE", ctx.party("DEALER", e.data.dealerId), e.data.amount, `Dukaan dealer commission paid (${e.data.orderCount} orders)${ref(e.data.reference)}`);
    case "rider_withdrawal.paid":
      return payout(date, sourceRef, ctx, "DUKAAN_RIDER_PAYABLE", ctx.party("RIDER", e.data.riderId), e.data.amount, `Dukaan rider withdrawal paid${ref(e.data.reference)}`);
    case "rider_wallet.adjustment": {
      const d = e.data;
      if (!d.amount) return null;
      const rider = ctx.party("RIDER", d.riderId);
      return {
        date,
        sourceRef,
        narration: `Dukaan rider wallet adjustment${d.note ? `: ${d.note}` : ""}`,
        lines: [
          { key: "DUKAAN_DELIVERY_COST", amount: d.amount, partyId: rider, memo: "Wallet adjustment" },
          { key: "DUKAAN_RIDER_PAYABLE", amount: -d.amount, partyId: rider, memo: "Wallet adjustment" },
        ],
      };
    }
  }
}

const ref = (r: string | null) => (r ? ` · UTR ${r}` : "");

function payout(date: Date, sourceRef: string, ctx: MapContext, key: "DUKAAN_SHOP_PAYABLE" | "DUKAAN_DEALER_PAYABLE" | "DUKAAN_RIDER_PAYABLE", partyId: string, amount: number, narration: string): MappedEntry | null {
  if (!amount) return null;
  return {
    date,
    sourceRef,
    narration,
    lines: [
      { key, amount, partyId, memo: "Payout" },
      { accountId: ctx.payoutAccountId, amount: -amount, partyId, memo: "Payout" },
    ],
  };
}
