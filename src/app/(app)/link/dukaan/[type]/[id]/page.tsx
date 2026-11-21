import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";

/**
 * Deep links from the Dukaan Express admin panel, e.g.
 *   /link/dukaan/shop/<shopId>     → CRM record of the shop
 *   /link/dukaan/order/<orderId>   → journal entry of the delivered order
 * Types: shop, owner, dealer, rider, customer, order.
 */
const PARTY_TYPES: Record<string, string> = { shop: "SHOP", owner: "SHOP_OWNER", dealer: "DEALER", rider: "RIDER", customer: "CUSTOMER" };

export default async function DukaanLink({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  await requireUser();
  if (type === "order") {
    const entry = await db.journalEntry.findUnique({ where: { sourceRef: `dukaan:order.delivered:${id}` }, select: { id: true } });
    if (entry) redirect(`/accounting/journal/${entry.id}`);
  } else if (PARTY_TYPES[type]) {
    const party = await db.party.findUnique({ where: { extSource_extType_extId: { extSource: "DUKAAN", extType: PARTY_TYPES[type], extId: id } }, select: { id: true } });
    if (party) redirect(`/crm/contacts/${party.id}`);
  }
  return (
    <>
      <PageHeader title="Not in Metech ERP yet" description={type === "order" ? "This order has no accounting entry yet. Orders are booked once they are delivered and the next sync has run." : "This Dukaan record has not been synced yet."} />
      <Button asChild>
        <Link href="/integrations/dukaan">Go to Dukaan sync</Link>
      </Button>
    </>
  );
}
