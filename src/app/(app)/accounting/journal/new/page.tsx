import { requirePermission } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { todayIso } from "@/lib/dates";
import { PageHeader } from "@/components/page";
import { JournalForm } from "./journal-form";

export const metadata = { title: "Manual journal entry" };

export default async function NewJournalPage() {
  await requirePermission("accounting.write");
  const [accounts, parties, centres] = await Promise.all([lookups.accounts(), lookups.parties(), lookups.costCentres()]);
  return (
    <>
      <PageHeader title="Manual journal entry" description="For opening balances, adjustments, depreciation, Cashfree settlements to bank and other non-document postings. Debits must equal credits." />
      <JournalForm accounts={accounts} parties={parties} centres={centres} today={todayIso()} />
    </>
  );
}
