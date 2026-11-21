import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { dateRange } from "@/lib/dates";
import { Empty, Money, PageHeader, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms";

export const metadata = { title: "Journal" };

const SOURCES = ["MANUAL", "SALES_INVOICE", "PURCHASE_INVOICE", "RECEIPT", "PAYMENT", "EXPENSE", "DUKAAN", "OPENING"];

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; source?: string; q?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const r = dateRange(sp);
  const where: Prisma.JournalEntryWhereInput = {
    date: { gte: r.from, lte: r.to },
    ...(sp.source ? { source: sp.source as "MANUAL" } : {}),
    ...(sp.q ? { OR: [{ narration: { contains: sp.q, mode: "insensitive" } }, { number: { contains: sp.q } }] } : {}),
  };
  const entries = await db.journalEntry.findMany({ where, include: { lines: { select: { debit: true } } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 300 });
  return (
    <>
      <PageHeader
        title="Journal"
        description="Every posting in the books — from invoices, payments, expenses, the Dukaan sync and manual entries"
        actions={
          can(user.role, "accounting.write") && (
            <Button asChild>
              <Link href="/accounting/journal/new">
                <Plus /> Manual entry
              </Link>
            </Button>
          )
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input type="date" name="from" defaultValue={r.fromIso} className="w-40" />
        <Input type="date" name="to" defaultValue={r.toIso} className="w-40" />
        <NativeSelect name="source" defaultValue={sp.source ?? ""} className="w-44">
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </NativeSelect>
        <Input name="q" defaultValue={sp.q} placeholder="Search narration or number" className="w-56" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {entries.length === 0 ? (
        <Empty>No entries in this period.</Empty>
      ) : (
        <T head={["Number", "Date", "Narration", "Source", <span key="a" className="block text-right">Amount</span>]}>
          {entries.map((e) => (
            <tr key={e.id} className={e.voided ? "opacity-50" : "hover:bg-muted/30"}>
              <td className={td}>
                <Link href={`/accounting/journal/${e.id}`} className="text-primary hover:underline">
                  {e.number}
                </Link>
              </td>
              <td className={td}>{fmtDate(e.date)}</td>
              <td className={td}>
                {e.narration} {e.voided && <Pill tone="red">void</Pill>}
              </td>
              <td className={td}>
                <Pill tone={e.source === "DUKAAN" ? "blue" : "default"}>{e.source.replace("_", " ").toLowerCase()}</Pill>
              </td>
              <td className={tdNum}>
                <Money value={e.lines.reduce((s, l) => s + l.debit, 0)} />
              </td>
            </tr>
          ))}
        </T>
      )}
    </>
  );
}
