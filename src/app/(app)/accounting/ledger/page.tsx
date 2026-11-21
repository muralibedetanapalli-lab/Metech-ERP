import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { ledger } from "@/server/accounting/reports";
import { lookups } from "@/server/lookups";
import { dateRange } from "@/lib/dates";
import { formatAmount } from "@/lib/money";
import { Empty, PageHeader, T, td, tdNum } from "@/components/page";
import { NativeSelect } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Ledger" };

const drcr = (v: number) => `${formatAmount(Math.abs(v))} ${v >= 0 ? "Dr" : "Cr"}`;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ accountId?: string; partyId?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const r = dateRange(sp);
  const [accounts, parties] = await Promise.all([lookups.accounts(), lookups.parties()]);
  const chosen = sp.accountId || sp.partyId;
  const data = chosen ? await ledger({ accountId: sp.accountId || undefined, partyId: sp.partyId || undefined, from: r.from, to: r.to }) : null;
  const title = [accounts.find((a) => a.id === sp.accountId)?.name, parties.find((p) => p.id === sp.partyId)?.name].filter(Boolean).join(" · ");
  const exportQs = new URLSearchParams({ ...(sp.accountId ? { accountId: sp.accountId } : {}), ...(sp.partyId ? { partyId: sp.partyId } : {}), from: r.fromIso, to: r.toIso });
  return (
    <>
      <PageHeader
        title={title ? `Ledger — ${title}` : "Ledger"}
        description="Account or party statement with running balance"
        actions={
          data && (
            <>
              <Button variant="outline" asChild>
                <a href={`/api/reports/ledger?${exportQs}&format=xlsx`}>Excel</a>
              </Button>
              <Button variant="outline" asChild>
                <a href={`/api/reports/ledger?${exportQs}&format=pdf`} target="_blank">
                  PDF
                </a>
              </Button>
            </>
          )
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <NativeSelect name="accountId" defaultValue={sp.accountId ?? ""} className="w-64">
          <option value="">Any account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="partyId" defaultValue={sp.partyId ?? ""} className="w-64">
          <option value="">Any party</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" name="from" defaultValue={r.fromIso} className="w-40" />
        <Input type="date" name="to" defaultValue={r.toIso} className="w-40" />
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      {!data ? (
        <Empty>Choose an account or a party.</Empty>
      ) : (
        <T head={["Date", "Entry", "Account", "Narration", <span key="d" className="block text-right">Debit</span>, <span key="c" className="block text-right">Credit</span>, <span key="b" className="block text-right">Balance</span>]}>
          <tr className="bg-muted/30">
            <td className={td} colSpan={6}>
              Opening balance
            </td>
            <td className={tdNum}>{drcr(data.openingBalance)}</td>
          </tr>
          {data.rows.map((row, i) => (
            <tr key={i}>
              <td className={td}>{row.date}</td>
              <td className={td}>
                <Link className="text-primary hover:underline" href={`/accounting/journal/${row.entryId}`}>
                  {row.number}
                </Link>
              </td>
              <td className={td}>{row.account}</td>
              <td className={td}>{row.narration}</td>
              <td className={tdNum}>{row.debit ? formatAmount(row.debit) : ""}</td>
              <td className={tdNum}>{row.credit ? formatAmount(row.credit) : ""}</td>
              <td className={tdNum}>{drcr(row.balance)}</td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <td className={td} colSpan={6}>
              Closing balance
            </td>
            <td className={tdNum}>{drcr(data.closingBalance)}</td>
          </tr>
        </T>
      )}
    </>
  );
}
