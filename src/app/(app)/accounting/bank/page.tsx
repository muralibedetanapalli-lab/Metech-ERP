import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { naturalBalance } from "@/server/accounting/reports";
import { can } from "@/lib/permissions";
import { Empty, Money, PageHeader, Panel, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, NativeSelect, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bookStatementLine, deleteStatementLine, importStatement, reconcileLine } from "../actions";

export const metadata = { title: "Bank reconciliation" };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ accountId?: string; show?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const writable = can(user.role, "accounting.write");
  const banks = (await lookups.bankAccounts()).filter((b) => !b.code.startsWith("14"));
  const accountId = sp.accountId ?? banks[0]?.id;
  if (!accountId) return <Empty>Add a bank account in the chart of accounts first.</Empty>;
  const [statement, bookAgg, unmatchedBook, accounts, parties] = await Promise.all([
    db.bankStatementLine.findMany({ where: { accountId, ...(sp.show === "all" ? {} : { journalLineId: null }) }, include: { journalLine: { include: { entry: { select: { id: true, number: true } } } } }, orderBy: { date: "asc" }, take: 300 }),
    db.journalLine.aggregate({ where: { accountId, entry: { voided: false } }, _sum: { debit: true, credit: true } }),
    db.journalLine.findMany({ where: { accountId, entry: { voided: false }, reconciledWith: null }, include: { entry: { select: { id: true, number: true, date: true, narration: true } } }, orderBy: { entry: { date: "asc" } }, take: 500 }),
    lookups.accounts(),
    lookups.parties(),
  ]);
  const statementBalance = (await db.bankStatementLine.aggregate({ where: { accountId }, _sum: { amount: true } }))._sum.amount ?? 0;
  const bookBalance = naturalBalance({ type: "ASSET", debit: bookAgg._sum.debit ?? 0, credit: bookAgg._sum.credit ?? 0 });

  return (
    <>
      <PageHeader title="Bank reconciliation" description="Import the bank statement (CSV), match each line to a posting in the books, or book bank-only items such as charges, interest or Cashfree settlements." />
      <form className="mb-4 flex gap-2">
        <NativeSelect name="accountId" defaultValue={accountId} className="w-72">
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="show" defaultValue={sp.show ?? ""} className="w-44">
          <option value="">Unreconciled only</option>
          <option value="all">All statement lines</option>
        </NativeSelect>
        <Button variant="outline" type="submit">
          Show
        </Button>
      </form>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Panel title="Balance in books">
          <Money value={bookBalance} className="text-xl font-semibold" />
        </Panel>
        <Panel title="Imported statement total">
          <Money value={statementBalance} className="text-xl font-semibold" />
        </Panel>
        <Panel title="Unmatched book entries">
          <span className="text-xl font-semibold">{unmatchedBook.length}</span>
        </Panel>
      </div>
      {writable && (
        <Panel title="Import statement CSV" className="mb-6">
          <ActionForm action={importStatement} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="accountId" value={accountId} />
            <Input type="file" name="file" accept=".csv,text/csv" className="max-w-sm" required />
            <SubmitButton>Import</SubmitButton>
            <p className="w-full text-xs text-muted-foreground">Columns: Date, Description, Amount (+ deposit / − withdrawal), optional Reference — or Date, Description, Withdrawal, Deposit. Dates as YYYY-MM-DD or DD/MM/YYYY.</p>
          </ActionForm>
        </Panel>
      )}
      {statement.length === 0 ? (
        <Empty>No {sp.show === "all" ? "" : "unreconciled "}statement lines.</Empty>
      ) : (
        <T head={["Date", "Description", <span key="a" className="block text-right">Amount</span>, "Match"]}>
          {statement.map((s) => {
            const candidates = unmatchedBook.filter((l) => l.debit - l.credit === s.amount);
            const best = [...candidates].sort((a, b) => Math.abs(a.entry.date.getTime() - s.date.getTime()) - Math.abs(b.entry.date.getTime() - s.date.getTime()));
            return (
              <tr key={s.id} className="align-top">
                <td className={td}>{fmtDate(s.date)}</td>
                <td className={td}>
                  {s.description}
                  {s.reference && <div className="text-xs text-muted-foreground">{s.reference}</div>}
                </td>
                <td className={tdNum}>
                  <Money value={s.amount} />
                </td>
                <td className={td}>
                  {s.journalLine ? (
                    <div className="flex items-center gap-2">
                      <Pill tone="green">Reconciled</Pill>
                      <Link href={`/accounting/journal/${s.journalLine.entry.id}`} className="text-xs text-primary hover:underline">
                        {s.journalLine.entry.number}
                      </Link>
                      {writable && (
                        <form action={reconcileLine}>
                          <input type="hidden" name="statementId" value={s.id} />
                          <Button size="xs" variant="ghost" type="submit">
                            Undo
                          </Button>
                        </form>
                      )}
                    </div>
                  ) : writable ? (
                    <div className="grid gap-2">
                      {best.length > 0 && (
                        <form action={reconcileLine} className="flex gap-1">
                          <input type="hidden" name="statementId" value={s.id} />
                          <NativeSelect name="journalLineId" className="h-8 w-72 text-xs">
                            {best.slice(0, 10).map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.entry.number} · {l.entry.date.toISOString().slice(0, 10)} · {l.entry.narration.slice(0, 50)}
                              </option>
                            ))}
                          </NativeSelect>
                          <Button size="sm" type="submit">
                            Match
                          </Button>
                        </form>
                      )}
                      <ActionForm action={bookStatementLine} className="flex flex-wrap gap-1">
                        <input type="hidden" name="statementId" value={s.id} />
                        <NativeSelect name="counterAccountId" className="h-8 w-56 text-xs" defaultValue="">
                          <option value="">Book to account…</option>
                          {accounts
                            .filter((a) => a.id !== accountId)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} · {a.name}
                              </option>
                            ))}
                        </NativeSelect>
                        <NativeSelect name="partyId" className="h-8 w-40 text-xs" defaultValue="">
                          <option value="">No party</option>
                          {parties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </NativeSelect>
                        <SubmitButton size="sm" variant="outline">
                          Book
                        </SubmitButton>
                      </ActionForm>
                      <form action={deleteStatementLine}>
                        <input type="hidden" name="statementId" value={s.id} />
                        <Button size="xs" variant="ghost" type="submit" className="text-muted-foreground">
                          Delete line
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <Pill tone="amber">Unreconciled</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </T>
      )}
    </>
  );
}
