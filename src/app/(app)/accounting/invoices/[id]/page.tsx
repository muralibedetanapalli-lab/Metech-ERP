import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { GST_STATES } from "@/lib/gst";
import { Money, PageHeader, Panel, Pill, T, fmtDate, statusTone, td, tdNum } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { voidInvoiceAction } from "../../actions";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const inv = await db.invoice.findUnique({
    where: { id },
    include: { party: true, lines: { orderBy: { sortOrder: "asc" }, include: { account: { select: { code: true, name: true } } } }, allocations: { include: { payment: true } } },
  });
  if (!inv) notFound();
  const sales = inv.kind === "SALES";
  const writable = can(user.role, "accounting.write");
  const balance = inv.total - inv.amountPaid;
  return (
    <>
      <PageHeader
        title={`${sales ? "Invoice" : "Bill"} ${inv.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={statusTone(inv.status)}>{inv.status === "POSTED" ? "UNPAID" : inv.status}</Pill>
            <Link href={`/crm/contacts/${inv.party.id}`} className="text-primary hover:underline">
              {inv.party.name}
            </Link>
            · {fmtDate(inv.date)} · place of supply {inv.placeOfSupply} {GST_STATES[inv.placeOfSupply]}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/invoices/${inv.id}/pdf`} target="_blank">
                <FileDown /> PDF
              </a>
            </Button>
            {writable && inv.status !== "VOID" && balance > 0 && (
              <Button asChild>
                <Link href={`/accounting/payments?kind=${sales ? "RECEIPT" : "PAYMENT"}&partyId=${inv.party.id}&invoiceId=${inv.id}`}>{sales ? "Record receipt" : "Record payment"}</Link>
              </Button>
            )}
            {inv.journalEntryId && (
              <Button variant="ghost" asChild>
                <Link href={`/accounting/journal/${inv.journalEntryId}`}>Journal entry</Link>
              </Button>
            )}
          </>
        }
      />
      <T head={["Description", "HSN/SAC", "Account", <span key="q" className="block text-right">Qty</span>, <span key="r" className="block text-right">Rate</span>, <span key="t" className="block text-right">Taxable</span>, "GST", <span key="g" className="block text-right">Tax</span>, <span key="a" className="block text-right">Amount</span>]}>
        {inv.lines.map((l) => (
          <tr key={l.id}>
            <td className={td}>{l.description}</td>
            <td className={td}>{l.hsnSac ?? "—"}</td>
            <td className={td}>
              {l.account.code} · {l.account.name}
            </td>
            <td className={tdNum}>{l.quantity}</td>
            <td className={tdNum}>
              <Money value={l.rate} />
            </td>
            <td className={tdNum}>
              <Money value={l.taxable} />
            </td>
            <td className={td}>{l.taxRateBps / 100}%</td>
            <td className={tdNum}>
              <Money value={l.cgst + l.sgst + l.igst} />
            </td>
            <td className={tdNum}>
              <Money value={l.amount} />
            </td>
          </tr>
        ))}
      </T>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel title="Payments">
          {inv.allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {inv.allocations.map((a) => (
                <li key={a.id} className="flex justify-between">
                  <span>
                    {a.payment.number} · {fmtDate(a.payment.date)}
                  </span>
                  <Money value={a.amount} />
                </li>
              ))}
            </ul>
          )}
          {inv.notes && <p className="mt-3 border-t pt-3 text-sm whitespace-pre-wrap text-muted-foreground">{inv.notes}</p>}
        </Panel>
        <Panel title="Totals">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Taxable</dt>
            <dd className="text-right">
              <Money value={inv.taxableAmount} />
            </dd>
            {inv.igst > 0 ? (
              <>
                <dt className="text-muted-foreground">IGST</dt>
                <dd className="text-right">
                  <Money value={inv.igst} />
                </dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">CGST</dt>
                <dd className="text-right">
                  <Money value={inv.cgst} />
                </dd>
                <dt className="text-muted-foreground">SGST</dt>
                <dd className="text-right">
                  <Money value={inv.sgst} />
                </dd>
              </>
            )}
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold">
              <Money value={inv.total} />
            </dd>
            <dt className="text-muted-foreground">Balance due</dt>
            <dd className="text-right">
              <Money value={inv.status === "VOID" ? 0 : balance} />
            </dd>
          </dl>
          {writable && inv.status !== "VOID" && inv.allocations.length === 0 && (
            <ActionForm action={voidInvoiceAction} className="mt-4 flex gap-2 border-t pt-4">
              <input type="hidden" name="id" value={inv.id} />
              <Input name="reason" placeholder="Reason for voiding" required />
              <SubmitButton variant="destructive">Void</SubmitButton>
            </ActionForm>
          )}
        </Panel>
      </div>
    </>
  );
}
