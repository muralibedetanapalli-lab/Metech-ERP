import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageHeader, Pill, T, fmtDate, statusTone, td, tdNum } from "@/components/page";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Invoices" };


export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind === "PURCHASE" ? "PURCHASE" : "SALES";
  const user = await requireUser();
  const invoices = await db.invoice.findMany({
    where: { kind, ...(sp.status ? { status: sp.status as "POSTED" } : {}) },
    include: { party: { select: { id: true, name: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });
  const due = invoices.filter((i) => i.status === "POSTED" || i.status === "PARTIAL").reduce((s, i) => s + i.total - i.amountPaid, 0);
  const label = kind === "SALES" ? "Sales invoices" : "Purchase bills";
  return (
    <>
      <PageHeader
        title={label}
        description={
          <>
            Outstanding <Money value={due} />
          </>
        }
        actions={
          can(user.role, "accounting.write") && (
            <Button asChild>
              <Link href={`/accounting/invoices/new?kind=${kind}`}>
                <Plus /> New {kind === "SALES" ? "invoice" : "bill"}
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-3 flex gap-2 text-sm">
        {["", "POSTED", "PARTIAL", "PAID", "VOID"].map((s) => (
          <Link key={s} href={`?kind=${kind}${s ? `&status=${s}` : ""}`} className={`rounded-full border px-3 py-1 ${(sp.status ?? "") === s ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {s ? (s === "POSTED" ? "Unpaid" : s.charAt(0) + s.slice(1).toLowerCase()) : "All"}
          </Link>
        ))}
      </div>
      {invoices.length === 0 ? (
        <Empty>No {label.toLowerCase()} yet.</Empty>
      ) : (
        <T head={["Number", "Party", "Date", "Due", "Status", <span key="a" className="block text-right">Taxable</span>, <span key="b" className="block text-right">GST</span>, <span key="c" className="block text-right">Total</span>, <span key="d" className="block text-right">Balance</span>]}>
          {invoices.map((i) => (
            <tr key={i.id} className="hover:bg-muted/30">
              <td className={td}>
                <Link href={`/accounting/invoices/${i.id}`} className="font-medium text-primary hover:underline">
                  {i.number}
                </Link>
                {i.vendorRef && <div className="text-xs text-muted-foreground">Bill {i.vendorRef}</div>}
              </td>
              <td className={td}>
                <Link href={`/crm/contacts/${i.party.id}`} className="hover:underline">
                  {i.party.name}
                </Link>
              </td>
              <td className={td}>{fmtDate(i.date)}</td>
              <td className={td}>{fmtDate(i.dueDate)}</td>
              <td className={td}>
                <Pill tone={statusTone(i.status)}>{i.status === "POSTED" ? "UNPAID" : i.status}</Pill>
              </td>
              <td className={tdNum}>
                <Money value={i.taxableAmount} />
              </td>
              <td className={tdNum}>
                <Money value={i.cgst + i.sgst + i.igst} />
              </td>
              <td className={tdNum}>
                <Money value={i.total} />
              </td>
              <td className={tdNum}>
                <Money value={i.status === "VOID" ? 0 : i.total - i.amountPaid} />
              </td>
            </tr>
          ))}
        </T>
      )}
    </>
  );
}
