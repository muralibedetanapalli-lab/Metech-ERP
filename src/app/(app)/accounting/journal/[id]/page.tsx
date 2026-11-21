import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { dukaanAdminUrl } from "@/server/dukaan/sync";
import { can } from "@/lib/permissions";
import { Money, PageHeader, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { voidJournal } from "../../actions";

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const e = await db.journalEntry.findUnique({
    where: { id },
    include: {
      lines: { include: { account: true, party: { select: { id: true, name: true } }, costCentre: { select: { code: true } } }, orderBy: [{ debit: "desc" }] },
      createdBy: { select: { name: true } },
    },
  });
  if (!e) notFound();
  // Dukaan entries link back to the order / payout in the Dukaan admin panel.
  const m = e.sourceRef?.match(/^dukaan:([a-z_.]+):(.+)$/);
  const dukaanPath = m ? ({ "order.delivered": `/admin/orders/${m[2]}`, "shop_settlement.paid": "/admin/finance", "dealer_payout.paid": "/admin/finance", "rider_withdrawal.paid": "/admin/finance" } as Record<string, string>)[m[1]] : undefined;
  const dukaanUrl = dukaanAdminUrl(dukaanPath);
  const doc = await (async () => {
    if (e.sourceRef?.startsWith("invoice:")) return { href: `/accounting/invoices/${e.sourceRef.slice(8)}`, label: "Open invoice" };
    return null;
  })();
  const total = e.lines.reduce((s, l) => s + l.debit, 0);
  return (
    <>
      <PageHeader
        title={`Journal ${e.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {fmtDate(e.date)} · <Pill tone={e.source === "DUKAAN" ? "blue" : "default"}>{e.source.replace("_", " ").toLowerCase()}</Pill>
            {e.voided && <Pill tone="red">void: {e.voidReason}</Pill>}
            {e.createdBy && <span>by {e.createdBy.name}</span>}
          </span>
        }
        actions={
          <>
            {doc && (
              <Button variant="outline" asChild>
                <Link href={doc.href}>{doc.label}</Link>
              </Button>
            )}
            {dukaanUrl && (
              <Button variant="outline" asChild>
                <a href={dukaanUrl} target="_blank" rel="noreferrer">
                  Open in Dukaan admin <ExternalLink />
                </a>
              </Button>
            )}
          </>
        }
      />
      <p className="mb-4 text-sm">{e.narration}</p>
      <T head={["Account", "Party", "Memo", "Cost centre", <span key="d" className="block text-right">Debit</span>, <span key="c" className="block text-right">Credit</span>]}>
        {e.lines.map((l) => (
          <tr key={l.id}>
            <td className={td}>
              <Link href={`/accounting/ledger?accountId=${l.accountId}`} className="hover:underline">
                {l.account.code} · {l.account.name}
              </Link>
            </td>
            <td className={td}>{l.party ? <Link href={`/crm/contacts/${l.party.id}`} className="text-primary hover:underline">{l.party.name}</Link> : "—"}</td>
            <td className={td}>{l.memo ?? ""}</td>
            <td className={td}>{l.costCentre?.code ?? ""}</td>
            <td className={tdNum}>{l.debit ? <Money value={l.debit} /> : ""}</td>
            <td className={tdNum}>{l.credit ? <Money value={l.credit} /> : ""}</td>
          </tr>
        ))}
        <tr className="bg-muted/40 font-semibold">
          <td className={td} colSpan={4}>
            Total
          </td>
          <td className={tdNum}>
            <Money value={total} />
          </td>
          <td className={tdNum}>
            <Money value={e.lines.reduce((s, l) => s + l.credit, 0)} />
          </td>
        </tr>
      </T>
      {can(user.role, "accounting.write") && !e.voided && ["MANUAL", "OPENING", "DUKAAN"].includes(e.source) && (
        <ActionForm action={voidJournal} className="mt-6 flex max-w-lg gap-2">
          <input type="hidden" name="id" value={e.id} />
          <Input name="reason" placeholder="Reason for voiding" required />
          <SubmitButton variant="destructive">Void entry</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
