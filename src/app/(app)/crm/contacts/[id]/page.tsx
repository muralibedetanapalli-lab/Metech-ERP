import Link from "next/link";
import { docLabel, docSign, statusLabel } from "@/lib/doc-types";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { dukaanAdminUrl } from "@/server/dukaan/sync";
import { can } from "@/lib/permissions";
import { GST_STATES } from "@/lib/gst";
import { Empty, Money, PageHeader, Panel, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EditPartyForm } from "../../party-form";
import { ActivityForm } from "../../activity-form";
import { addActivity, toggleActivity, updateParty } from "../../actions";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const p = await db.party.findUnique({
    where: { id },
    include: {
      org: { select: { id: true, name: true } },
      members: { select: { id: true, name: true, phone: true } },
      deals: { include: { stage: true }, orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 50, include: { assignee: { select: { name: true } } } },
      invoices: { orderBy: { date: "desc" }, take: 20 },
    },
  });
  if (!p) notFound();
  const [balances, orgs, users] = await Promise.all([
    db.journalLine.groupBy({ by: ["accountId"], where: { partyId: id, entry: { voided: false } }, _sum: { debit: true, credit: true } }),
    db.party.findMany({ where: { kind: "ORGANIZATION", archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const accounts = await db.account.findMany({ where: { id: { in: balances.map((b) => b.accountId) } } });
  const ext = (p.extData ?? {}) as Record<string, unknown>;
  const adminUrl = p.extSource === "DUKAAN" ? dukaanAdminUrl(ext.adminPath as string | undefined) : null;
  const writable = can(user.role, "crm.write");

  return (
    <>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill>{p.kind === "PERSON" ? "Person" : "Company"}</Pill>
            {p.isCustomer && <Pill tone="green">Customer</Pill>}
            {p.isVendor && <Pill tone="amber">Vendor</Pill>}
            {p.extType && <Pill tone="blue">Dukaan {p.extType.toLowerCase().replace("_", " ")}</Pill>}
            {p.org && (
              <Link href={`/crm/contacts/${p.org.id}`} className="text-primary hover:underline">
                at {p.org.name}
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {adminUrl && (
              <Button variant="outline" asChild>
                <a href={adminUrl} target="_blank" rel="noreferrer">
                  Open in Dukaan admin <ExternalLink />
                </a>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/accounting/ledger?partyId=${p.id}`}>Party ledger</Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 lg:col-span-2">
          <Panel title="Activity, notes & follow-ups">
            {writable && <ActivityForm action={addActivity} partyId={p.id} users={users} />}
            <ul className="mt-4 divide-y text-sm">
              {p.activities.length === 0 && <li className="py-3 text-muted-foreground">No activity yet.</li>}
              {p.activities.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={a.type === "TASK" || a.type === "FOLLOW_UP" ? "amber" : "default"}>{a.type.replace("_", " ").toLowerCase()}</Pill>
                      <span className={a.doneAt && a.dueAt ? "line-through opacity-60" : "font-medium"}>{a.subject}</span>
                    </div>
                    {a.body && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.body}</p>}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtDate(a.createdAt)}
                      {a.dueAt && ` · due ${fmtDate(a.dueAt)}`}
                      {a.assignee && ` · ${a.assignee.name}`}
                    </div>
                  </div>
                  {a.dueAt && writable && (
                    <form action={toggleActivity}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button size="xs" variant="outline" type="submit">
                        {a.doneAt ? "Reopen" : "Done"}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Invoices & bills">
            {p.invoices.length === 0 ? (
              <Empty>No invoices.</Empty>
            ) : (
              <T head={["Number", "Type", "Date", "Status", <span key="t" className="block text-right">Total</span>, <span key="b" className="block text-right">Balance</span>]}>
                {p.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className={td}>
                      <Link className="text-primary hover:underline" href={`/accounting/invoices/${i.id}`}>
                        {i.number}
                      </Link>
                    </td>
                    <td className={td}>
                      {i.kind === "SALES" ? "Sales" : "Purchase"}
                      {i.docType !== "INVOICE" && ` · ${docLabel(i.kind, i.docType, true).toLowerCase()}`}
                    </td>
                    <td className={td}>{fmtDate(i.date)}</td>
                    <td className={td}>
                      <Pill tone={i.status === "PAID" ? "green" : i.status === "VOID" ? "red" : "amber"}>{statusLabel(i.docType, i.status)}</Pill>
                    </td>
                    <td className={tdNum}>
                      <Money value={docSign(i.docType) * i.total} />
                    </td>
                    <td className={tdNum}>
                      <Money value={i.status === "VOID" ? 0 : docSign(i.docType) * (i.total - i.amountPaid)} />
                    </td>
                  </tr>
                ))}
              </T>
            )}
          </Panel>
          {writable && (
            <Panel title="Edit details">
              <EditPartyForm action={updateParty} orgs={orgs.filter((o) => o.id !== p.id)} d={{ ...p, synced: p.extSource === "DUKAAN" }} />
            </Panel>
          )}
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Details">
            <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{p.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all">{p.email ?? "—"}</dd>
              <dt className="text-muted-foreground">GSTIN</dt>
              <dd>{p.gstin ?? "—"}</dd>
              <dt className="text-muted-foreground">State</dt>
              <dd>{p.stateCode ? `${p.stateCode} · ${GST_STATES[p.stateCode] ?? ""}` : "—"}</dd>
              <dt className="text-muted-foreground">Address</dt>
              <dd>{[p.address, p.city, p.pincode].filter(Boolean).join(", ") || "—"}</dd>
            </dl>
            {p.extSource === "DUKAAN" && (
              <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">From Dukaan Express</div>
                {Object.entries(ext)
                  .filter(([k, v]) => k !== "links" && k !== "adminPath" && v !== null && v !== "")
                  .map(([k, v]) => (
                    <div key={k}>
                      {k}: {String(v)}
                    </div>
                  ))}
                <div>Last synced {fmtDate(p.extSyncedAt)}</div>
              </div>
            )}
          </Panel>
          <Panel title="Balances">
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions.</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {balances.map((b) => {
                  const a = accounts.find((x) => x.id === b.accountId)!;
                  const net = (b._sum.debit ?? 0) - (b._sum.credit ?? 0);
                  return (
                    <li key={b.accountId} className="flex justify-between gap-2">
                      <Link href={`/accounting/ledger?partyId=${p.id}&accountId=${a.id}`} className="truncate hover:underline">
                        {a.name}
                      </Link>
                      <span className="shrink-0 tabular-nums">
                        <Money value={Math.abs(net)} /> {net >= 0 ? "Dr" : "Cr"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {p.members.length > 0 && (
            <Panel title="People">
              <ul className="grid gap-1 text-sm">
                {p.members.map((m) => (
                  <li key={m.id}>
                    <Link href={`/crm/contacts/${m.id}`} className="text-primary hover:underline">
                      {m.name}
                    </Link>{" "}
                    <span className="text-muted-foreground">{m.phone}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Deals" actions={<Link href="/crm/deals" className="text-xs text-primary">Pipeline</Link>}>
            {p.deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deals.</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {p.deals.map((d) => (
                  <li key={d.id} className="flex justify-between gap-2">
                    <span>{d.title}</span>
                    <span className="flex items-center gap-2">
                      <Money value={d.value} compact /> <Pill>{d.stage.name}</Pill>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
