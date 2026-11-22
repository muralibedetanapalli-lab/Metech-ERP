import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { GST_STATES } from "@/lib/gst";
import { docLabel, docSign, statusLabel } from "@/lib/doc-types";
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
    include: {
      party: true,
      lines: { orderBy: { sortOrder: "asc" }, include: { account: { select: { code: true, name: true } } } },
      allocations: { include: { payment: true } },
      originalInvoice: { select: { id: true, number: true } },
      costCentre: { select: { id: true, code: true, name: true } },
      adjustments: { orderBy: { date: "asc" }, select: { id: true, number: true, docType: true, date: true, total: true, amountPaid: true, status: true } },
    },
  });
  if (!inv) notFound();
  const sales = inv.kind === "SALES";
  const writable = can(user.role, "accounting.write");
  const balance = inv.total - inv.amountPaid;
  const credit = inv.docType === "CREDIT_NOTE";
  const appliedNotes = inv.adjustments.filter((n) => n.docType === "CREDIT_NOTE" && n.status !== "VOID" && n.amountPaid > 0);
  return (
    <>
      <PageHeader
        title={`${docLabel(inv.kind, inv.docType)} ${inv.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={statusTone(inv.status)}>{statusLabel(inv.docType, inv.status)}</Pill>
            {inv.originalInvoice && (
              <>
                against
                <Link href={`/accounting/invoices/${inv.originalInvoice.id}`} className="text-primary hover:underline">
                  {inv.originalInvoice.number}
                </Link>
                ·
              </>
            )}
            <Link href={`/crm/contacts/${inv.party.id}`} className="text-primary hover:underline">
              {inv.party.name}
            </Link>
            · {fmtDate(inv.date)} · place of supply {inv.placeOfSupply} {GST_STATES[inv.placeOfSupply]}
            {inv.costCentre && (
              <>
                ·{" "}
                <Link href={`/erp/projects/${inv.costCentre.id}`} className="text-primary hover:underline">
                  {inv.costCentre.name}
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/invoices/${inv.id}/pdf`} target="_blank">
                <FileDown /> PDF
              </a>
            </Button>
            {writable && inv.docType === "INVOICE" && inv.status !== "VOID" && (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/accounting/invoices/new?kind=${inv.kind}&doc=CREDIT_NOTE&from=${inv.id}`}>Credit note</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/accounting/invoices/new?kind=${inv.kind}&doc=DEBIT_NOTE&from=${inv.id}`}>Debit note</Link>
                </Button>
              </>
            )}
            {writable && !credit && inv.status !== "VOID" && balance > 0 && (
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
        <Panel title={credit ? "Set-off" : "Payments & credit"}>
          {inv.noteReason && <p className="mb-3 text-sm">Reason: {inv.noteReason}</p>}
          {credit ? (
            <p className="text-sm text-muted-foreground">
              {inv.amountPaid > 0 && inv.originalInvoice ? (
                <>
                  <Money value={inv.amountPaid} /> set off against {inv.originalInvoice.number}.{" "}
                </>
              ) : null}
              {balance > 0 && inv.status !== "VOID" ? (
                <>
                  <Money value={balance} /> remains as open credit for {inv.party.name} (refund it with a payment / receipt, or keep it for the next invoice).
                </>
              ) : null}
            </p>
          ) : inv.allocations.length === 0 && appliedNotes.length === 0 ? (
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
              {appliedNotes.map((n) => (
                <li key={n.id} className="flex justify-between">
                  <Link href={`/accounting/invoices/${n.id}`} className="text-primary hover:underline">
                    Credit note {n.number} · {fmtDate(n.date)}
                  </Link>
                  <Money value={n.amountPaid} />
                </li>
              ))}
            </ul>
          )}
          {inv.adjustments.length > 0 && (
            <div className="mt-3 border-t pt-3 text-sm">
              <div className="mb-1 font-medium">Credit / debit notes</div>
              <ul className="grid gap-1">
                {inv.adjustments.map((n) => (
                  <li key={n.id} className="flex justify-between gap-2">
                    <Link href={`/accounting/invoices/${n.id}`} className="text-primary hover:underline">
                      {docLabel(inv.kind, n.docType, true)} {n.number}
                    </Link>
                    <span className="flex items-center gap-2">
                      <Pill tone={statusTone(n.status)}>{statusLabel(n.docType, n.status)}</Pill>
                      <Money value={docSign(n.docType) * n.total} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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
            <dt className="text-muted-foreground">{credit ? "Open credit" : "Balance due"}</dt>
            <dd className="text-right">
              <Money value={inv.status === "VOID" ? 0 : balance} />
            </dd>
          </dl>
          {writable && inv.status !== "VOID" && inv.allocations.length === 0 && inv.adjustments.every((n) => n.status === "VOID") && (
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
