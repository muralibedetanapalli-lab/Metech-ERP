import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { Money, PageHeader, Panel, Pill, T, fmtDate, isoDate, td } from "@/components/page";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { ExpenseFields } from "../expense-fields";
import { editExpense } from "../../actions";

export const metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("accounting.write");
  const e = await db.expense.findUnique({ where: { id } });
  if (!e) notFound();
  const [accounts, banks, parties, centres, synced, history, renewal] = await Promise.all([
    lookups.accounts(),
    lookups.bankAccounts(),
    lookups.parties({ isVendor: true }),
    lookups.costCentres(),
    db.syncEvent.findFirst({ where: { result: `expense:${id}` }, select: { projectId: true } }),
    db.journalEntry.findMany({
      where: { OR: [{ sourceRef: `expense:${id}` }, { sourceRef: { startsWith: `expense:${id}:edited:` } }] },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, voided: true, voidReason: true, createdAt: true },
    }),
    db.renewalEvent.findFirst({ where: { expenseId: id }, select: { renewal: { select: { id: true, name: true } } } }),
  ]);
  return (
    <>
      <PageHeader
        title="Edit expense"
        description={
          <span>
            {fmtDate(e.date)} · {e.description} · <Money value={e.amount + e.gstAmount} />
          </span>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/accounting/expenses">Back to expenses</Link>
          </Button>
        }
      />
      <div className="grid gap-6">
        <Panel title="Details">
          {synced ? (
            <p className="text-sm text-muted-foreground">This expense came from a project app&apos;s feed, so it can&apos;t be edited here. Correct it in that app.</p>
          ) : (
            <>
              <ActionForm key={e.journalEntryId ?? e.id} action={editExpense} resetOnSuccess={false} className="grid gap-3 md:grid-cols-4">
                <input type="hidden" name="id" value={e.id} />
                <ExpenseFields d={{ ...e, date: isoDate(e.date) }} accounts={accounts} banks={banks} parties={parties} centres={centres} />
                <div className="md:col-span-4">
                  <SubmitButton>Save changes</SubmitButton>
                </div>
              </ActionForm>
              <p className="mt-3 text-xs text-muted-foreground">
                Saving voids the current journal entry (kept for the audit trail) and posts a corrected one.
                {renewal && (
                  <>
                    {" "}
                    This is the payment for the renewal{" "}
                    <Link href={`/erp/renewals/${renewal.renewal.id}`} className="text-primary hover:underline">
                      {renewal.renewal.name}
                    </Link>
                    , which will show the new amount.
                  </>
                )}
              </p>
            </>
          )}
        </Panel>
        {history.length > 0 && (
          <Panel title="Journal entries">
            <T head={["Entry", "Posted", "Status"]}>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className={td}>
                    <Link href={`/accounting/journal/${h.id}`} className="text-primary hover:underline">
                      {h.number}
                    </Link>
                  </td>
                  <td className={td}>{fmtDate(h.createdAt)}</td>
                  <td className={td}>{h.voided ? <Pill tone="red">{h.voidReason ?? "voided"}</Pill> : <Pill tone="green">current</Pill>}</td>
                </tr>
              ))}
            </T>
          </Panel>
        )}
      </div>
    </>
  );
}
