/**
 * Wire contract between Dukaan Express and Metech ERP (server to server).
 *
 *   GET {DUKAAN_BASE_URL}/api/v1/integrations/erp/parties?after=<cursor>&limit=<n>
 *   GET {DUKAAN_BASE_URL}/api/v1/integrations/erp/events?after=<cursor>&limit=<n>
 *   Authorization: Bearer <DUKAAN_API_KEY>   (Dukaan side: ERP_API_KEY)
 *
 * Both feeds return { data: { items, nextCursor, hasMore } } ordered by a change timestamp, so the
 * ERP pulls only what changed since its last cursor. Items may be re-sent; the ERP is idempotent.
 * Money is integer paise, exactly as Dukaan stores it.
 */

export type DukaanPartyType = "SHOP" | "SHOP_OWNER" | "DEALER" | "RIDER" | "CUSTOMER";

export interface DukaanParty {
  type: DukaanPartyType;
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  active: boolean;
  /** Related Dukaan ids, e.g. a shop's ownerId / dealerId. */
  links: { ownerId?: string | null; dealerId?: string | null; serviceArea?: string | null };
  /** Small, non-sensitive extras shown in the CRM (approval status, delivery mode, rates, KYC status…). */
  extra: Record<string, string | number | boolean | null>;
  /** Path of the record in the Dukaan admin panel, e.g. "/admin/shops/<id>". */
  adminPath: string | null;
  updatedAt: string;
}

export type DukaanEvent =
  | {
      id: string;
      type: "order.delivered";
      occurredAt: string;
      data: {
        orderId: string;
        orderNumber: string;
        shopId: string;
        customerId: string;
        paymentMethod: "UPI" | "CARD" | "NETBANKING" | "COD";
        deliveryMode: "RIDER" | "OWN" | "SELF_BOOKED" | null;
        riderId: string | null;
        total: number;
        subtotal: number;
        couponDiscount: number;
        deliveryFee: number;
        taxAmount: number;
        commissionAmount: number;
        /** Commission.shopEarning: what the platform owes the shop for this order (negative when the shop holds COD cash). */
        shopEarning: number;
        riderFee: number;
        codAmount: number;
        dealerId: string | null;
        dealerAmount: number;
      };
    }
  | {
      id: string;
      type: "refund.processed";
      occurredAt: string;
      data: { refundId: string; orderId: string; orderNumber: string; customerId: string; amount: number; paymentMethod: string; orderDelivered: boolean };
    }
  | {
      id: string;
      type: "shop_settlement.paid";
      occurredAt: string;
      data: { settlementId: string; shopId: string; amount: number; orderCount: number; reference: string | null; method: string | null };
    }
  | {
      id: string;
      type: "dealer_payout.paid";
      occurredAt: string;
      data: { payoutId: string; dealerId: string; amount: number; orderCount: number; reference: string | null; method: string | null };
    }
  | {
      id: string;
      type: "rider_withdrawal.paid";
      occurredAt: string;
      data: { withdrawalId: string; riderId: string; amount: number; reference: string | null; method: string | null };
    }
  | {
      id: string;
      type: "rider_wallet.adjustment";
      occurredAt: string;
      data: { entryId: string; riderId: string; amount: number; note: string | null };
    };

export interface FeedPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
