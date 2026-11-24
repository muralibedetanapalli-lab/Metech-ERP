import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { can } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ExpenseFields } from "./expense-fields";
import { saveExpense } from "../actions";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const user = await requireUser();
  const writable = can(user.role, "accounting.write");
  const [expenses, accounts, banks, parties, centres] = await Promise.all([
    db.expense.findMany({ include: { account: { select: { name: true } }, paidFrom: { select: { name: true } }, party: { select: { id: true, name: true } } }, orderBy: { date: "desc" }, take: 200 }),
    lookups.accounts(),
    lookups.bankAccounts(),
    lookups.parties({ isVendor: true }),
    lookups.costCentres(),
  ]);
  const total = expenses.reduce((s, e) => s + e.amount + e.gstAmount, 0);
  return (
    <>
      <PageHeader title="Expenses" description="Quick entry for bills paid straight away (rent, hosting, travel…). For credit purchases, use a purchase bill." />
      {writable && (
        <Panel title="Record an expense" className="mb-6">
          <ActionForm action={saveExpense} className="grid gap-3 md:grid-cols-4">
            <ExpenseFields d={{ date: todayIso() }} accounts={accounts} banks={banks} parties={parties} centres={centres} />
            <div className="md:col-span-4">
              <SubmitButton>Record expense</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
      {expenses.length === 0 ? (
        <Empty>No expenses yet.</Empty>
      ) : (
        <T head={["Date", "Description", "Account", "Vendor", "Paid from", <span key="a" className="block text-right">Amount</span>, <span key="g" className="block text-right">GST</span>, <span key="t" className="block text-right">Total</span>, ""]}>
          {expenses.map((e) => (
            <tr key={e.id}>
              <td className={td}>{fmtDate(e.date)}</td>
              <td className={td}>{e.journalEntryId ? <Link className="text-primary hover:underline" href={`/accounting/journal/${e.journalEntryId}`}>{e.description}</Link> : e.description}</td>
              <td className={td}>{e.account.name}</td>
              <td className={td}>{e.party?.name ?? "—"}</td>
              <td className={td}>{e.paidFrom.name}</td>
              <td className={tdNum}>
                <Money value={e.amount} />
              </td>
              <td className={tdNum}>
                <Money value={e.gstAmount} />
              </td>
              <td className={tdNum}>
                <Money value={e.amount + e.gstAmount} />
              </td>
              <td className={td}>
                {writable && (
                  <Link className="text-xs text-primary hover:underline" href={`/accounting/expenses/${e.id}`}>
                    Edit
                  </Link>
                )}
              </td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <td className={td} colSpan={7}>
              Total
            </td>
            <td className={tdNum}>
              <Money value={total} />
            </td>
            <td className={td} />
          </tr>
        </T>
      )}
    </>
  );
}
