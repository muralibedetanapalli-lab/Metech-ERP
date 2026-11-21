import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { can } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { PaymentForm } from "./payment-form";

export const metadata = { title: "Receipts & payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ kind?: string; partyId?: string; invoiceId?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const writable = can(user.role, "accounting.write");
  const [payments, parties, banks, accounts, open] = await Promise.all([
    db.payment.findMany({ include: { party: { select: { id: true, name: true } }, bankAccount: { select: { name: true } }, allocations: { include: { invoice: { select: { number: true } } } } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 200 }),
    writable ? lookups.parties() : [],
    writable ? lookups.bankAccounts() : [],
    writable ? lookups.accounts() : [],
    writable ? db.invoice.findMany({ where: { status: { in: ["POSTED", "PARTIAL"] } }, select: { id: true, number: true, kind: true, partyId: true, total: true, amountPaid: true } }) : [],
  ]);
  return (
    <>
      <PageHeader title="Receipts & payments" description="Money received from customers and paid to vendors, settled against invoices" />
      {writable && (
        <Panel title="Record a receipt or payment" className="mb-6">
          <PaymentForm parties={parties} banks={banks} accounts={accounts} openInvoices={open.map((i) => ({ id: i.id, number: i.number, kind: i.kind, partyId: i.partyId, balance: i.total - i.amountPaid }))} today={todayIso()} defaults={sp} />
        </Panel>
      )}
      {payments.length === 0 ? (
        <Empty>No receipts or payments yet.</Empty>
      ) : (
        <T head={["Number", "Date", "Type", "Party", "Account", "Mode / ref", "Settles", <span key="a" className="block text-right">Amount</span>]}>
          {payments.map((p) => (
            <tr key={p.id}>
              <td className={td}>{p.journalEntryId ? <Link href={`/accounting/journal/${p.journalEntryId}`} className="text-primary hover:underline">{p.number}</Link> : p.number}</td>
              <td className={td}>{fmtDate(p.date)}</td>
              <td className={td}>
                <Pill tone={p.kind === "RECEIPT" ? "green" : "amber"}>{p.kind === "RECEIPT" ? "Receipt" : "Payment"}</Pill>
              </td>
              <td className={td}>{p.party ? <Link href={`/crm/contacts/${p.party.id}`} className="hover:underline">{p.party.name}</Link> : "—"}</td>
              <td className={td}>{p.bankAccount.name}</td>
              <td className={td}>
                {p.mode}
                {p.reference && <div className="text-xs text-muted-foreground">{p.reference}</div>}
              </td>
              <td className={td}>{p.allocations.map((a) => a.invoice.number).join(", ") || "—"}</td>
              <td className={tdNum}>
                <Money value={p.amount} />
              </td>
            </tr>
          ))}
        </T>
      )}
    </>
  );
}
