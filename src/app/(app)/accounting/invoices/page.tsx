import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { DOC_TYPES, docLabel, docSign, statusLabel, type DocType } from "@/lib/doc-types";
import { Empty, Money, PageHeader, Pill, T, fmtDate, statusTone, td, tdNum } from "@/components/page";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Invoices" };

const STATUSES = ["", "POSTED", "PARTIAL", "PAID", "VOID"] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; doc?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind === "PURCHASE" ? "PURCHASE" : "SALES";
  const doc = DOC_TYPES.includes(sp.doc as DocType) ? (sp.doc as DocType) : undefined;
  const status = sp.status && STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status as "POSTED") : undefined;
  const user = await requireUser();
  const invoices = await db.invoice.findMany({
    where: { kind, ...(status ? { status } : {}), ...(doc ? { docType: doc } : {}) },
    include: { party: { select: { id: true, name: true } }, originalInvoice: { select: { id: true, number: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });
  const due = invoices.filter((i) => i.status === "POSTED" || i.status === "PARTIAL").reduce((s, i) => s + docSign(i.docType) * (i.total - i.amountPaid), 0);
  const label = kind === "SALES" ? "Sales invoices & notes" : "Purchase bills & notes";
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ kind, ...(doc ? { doc } : {}), ...(status ? { status } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `?${p}`;
  };
  const writable = can(user.role, "accounting.write");
  return (
    <>
      <PageHeader
        title={label}
        description={
          <>
            Outstanding (net of open credit) <Money value={due} />
          </>
        }
        actions={
          writable && (
            <>
              <Button variant="outline" asChild>
                <Link href={`/accounting/invoices/new?kind=${kind}&doc=CREDIT_NOTE`}>Credit note</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/accounting/invoices/new?kind=${kind}&doc=DEBIT_NOTE`}>Debit note</Link>
              </Button>
              <Button asChild>
                <Link href={`/accounting/invoices/new?kind=${kind}`}>
                  <Plus /> New {kind === "SALES" ? "invoice" : "bill"}
                </Link>
              </Button>
            </>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {(["", ...DOC_TYPES] as const).map((d) => (
          <Link key={d || "all"} href={qs({ doc: d || undefined })} className={`rounded-full border px-3 py-1 ${(doc ?? "") === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {d ? `${docLabel(kind, d, true)}s` : "All documents"}
          </Link>
        ))}
        <span className="mx-1 border-l" />
        {STATUSES.map((s) => (
          <Link key={s || "any"} href={qs({ status: s || undefined })} className={`rounded-full border px-3 py-1 ${(status ?? "") === s ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {s ? (s === "POSTED" ? "Unpaid / open" : s === "PAID" ? "Paid / applied" : s.charAt(0) + s.slice(1).toLowerCase()) : "Any status"}
          </Link>
        ))}
      </div>
      {invoices.length === 0 ? (
        <Empty>Nothing here yet.</Empty>
      ) : (
        <T head={["Number", "Party", "Date", "Due", "Status", <span key="a" className="block text-right">Taxable</span>, <span key="b" className="block text-right">GST</span>, <span key="c" className="block text-right">Total</span>, <span key="d" className="block text-right">Balance</span>]}>
          {invoices.map((i) => {
            const sg = docSign(i.docType);
            return (
              <tr key={i.id} className="hover:bg-muted/30">
                <td className={td}>
                  <Link href={`/accounting/invoices/${i.id}`} className="font-medium text-primary hover:underline">
                    {i.number}
                  </Link>
                  {i.docType !== "INVOICE" && (
                    <div className="text-xs text-muted-foreground">
                      {docLabel(kind, i.docType, true)}
                      {i.originalInvoice && ` · against ${i.originalInvoice.number}`}
                    </div>
                  )}
                  {i.vendorRef && <div className="text-xs text-muted-foreground">Ref {i.vendorRef}</div>}
                </td>
                <td className={td}>
                  <Link href={`/crm/contacts/${i.party.id}`} className="hover:underline">
                    {i.party.name}
                  </Link>
                </td>
                <td className={td}>{fmtDate(i.date)}</td>
                <td className={td}>{fmtDate(i.dueDate)}</td>
                <td className={td}>
                  <Pill tone={statusTone(i.status)}>{statusLabel(i.docType, i.status)}</Pill>
                </td>
                <td className={tdNum}>
                  <Money value={sg * i.taxableAmount} />
                </td>
                <td className={tdNum}>
                  <Money value={sg * (i.cgst + i.sgst + i.igst)} />
                </td>
                <td className={tdNum}>
                  <Money value={sg * i.total} />
                </td>
                <td className={tdNum}>
                  <Money value={i.status === "VOID" ? 0 : sg * (i.total - i.amountPaid)} />
                </td>
              </tr>
            );
          })}
        </T>
      )}
    </>
  );
}
