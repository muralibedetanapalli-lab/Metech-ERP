import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { can } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { GST_RATES_BPS } from "@/lib/gst";
import { RENEWAL_CATEGORIES, addMonths, calendarDiff, cycleLabel, daysBetween, termProgress, timeLeft, urgencyTone, yearlyCost, type RenewalCategory } from "@/lib/renewals";
import { Empty, Money, PageHeader, Panel, Pill, T, fmtDate, isoDate, td, tdNum } from "@/components/page";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms";
import { RenewalFields } from "../renewal-fields";
import { deleteAction, renewAction, saveRenewal, setStatusAction } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.renewal.findUnique({ where: { id }, select: { name: true } });
  return { title: r?.name ?? "Renewal" };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function RenewalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const r = await db.renewal.findUnique({
    where: { id },
    include: { vendor: { select: { id: true, name: true } }, costCentre: { select: { id: true, code: true, name: true } }, history: { orderBy: { paidOn: "desc" } } },
  });
  if (!r) notFound();
  const [vendors, projects, accounts, banks] = await Promise.all([lookups.parties({ isVendor: true }), lookups.costCentres(), lookups.accounts(), lookups.bankAccounts()]);
  const today = todayIso();
  const active = r.status === "ACTIVE";
  const left = active ? timeLeft(r.renewalDate, today, r.remindDays) : null;
  const pct = active ? termProgress(r, today) : 0;
  const tone = left ? urgencyTone(left.urgency) : "default";
  const since = calendarDiff(r.startDate, today);
  const nextDate = r.cycleMonths > 0 ? addMonths(r.renewalDate, r.cycleMonths) : null;
  const account = r.accountId ? accounts.find((a) => a.id === r.accountId) : accounts.find((a) => a.code === "5310");
  const writable = can(user.role, "erp.write");
  const canBook = can(user.role, "accounting.write");
  return (
    <>
      <PageHeader
        title={r.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill>{RENEWAL_CATEGORIES[r.category as RenewalCategory] ?? r.category}</Pill>
            {r.provider && <span>{r.provider}</span>}
            {r.reference && <span>· {r.reference}</span>}
            {r.costCentre && (
              <>
                ·
                <Link href={`/erp/projects/${r.costCentre.id}`} className="text-primary hover:underline">
                  {r.costCentre.name}
                </Link>
              </>
            )}
            {!active && <Pill tone="red">cancelled</Pill>}
          </span>
        }
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 md:col-span-2">
          <div className="text-sm text-muted-foreground">Time left</div>
          <div className={`mt-1 text-3xl font-semibold ${tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : ""}`}>{left ? left.label : "Not renewing"}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Renewal date {fmtDate(r.renewalDate)}
            {left && left.days > 0 && ` · ${left.days} days`}
            {r.autoRenew && " · auto-renews at the provider"}
          </div>
          {active && (
            <>
              <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{pct}% of the current term used</span>
                <span>reminder {r.remindDays} days before</span>
              </div>
            </>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border bg-card p-4 text-sm">
          <dt className="text-muted-foreground">Started</dt>
          <dd>
            {fmtDate(r.startDate)} <span className="text-xs text-muted-foreground">({since.years ? `${since.years}y ` : ""}{since.months}m ago)</span>
          </dd>
          <dt className="text-muted-foreground">Cycle</dt>
          <dd>{cycleLabel(r.cycleMonths)}</dd>
          <dt className="text-muted-foreground">Price</dt>
          <dd>
            <Money value={r.amount} /> + {r.gstRateBps / 100}% GST
          </dd>
          <dt className="text-muted-foreground">Per year</dt>
          <dd>{r.cycleMonths ? <Money value={yearlyCost(r.amount, r.cycleMonths)} /> : "—"}</dd>
          <dt className="text-muted-foreground">Vendor</dt>
          <dd>{r.vendor ? <Link href={`/crm/contacts/${r.vendor.id}`} className="text-primary hover:underline">{r.vendor.name}</Link> : "—"}</dd>
          <dt className="text-muted-foreground">Booked to</dt>
          <dd>{account ? `${account.code} · ${account.name}` : "—"}</dd>
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {active && writable && (
          <Panel title="Renew" className="scroll-mt-4" >
            <div id="renew" />
            <ActionForm key={day(r.renewalDate)} action={renewAction} className="grid gap-3 md:grid-cols-2">
              <input type="hidden" name="id" value={r.id} />
              <Field label="Paid on" name="paidOn" type="date" required defaultValue={today} />
              <Field label="Renewed until" name="newRenewalDate" type="date" required={!nextDate} defaultValue={nextDate ? day(nextDate) : ""} hint={`Runs on from ${fmtDate(r.renewalDate)}`} />
              <Field label="Amount paid (₹, before GST)" name="amount" inputMode="decimal" defaultValue={r.amount ? String(r.amount / 100) : ""} />
              <SelectField label="GST" name="gstRateBps" defaultValue={String(r.gstRateBps)} options={GST_RATES_BPS.map((g) => ({ value: String(g), label: `${g / 100}%` }))} />
              {canBook ? (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="bookExpense" defaultChecked /> Book as an expense
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="interState" /> Vendor in another state (IGST)
                  </label>
                  <SelectField label="Paid from" name="paidFromId" defaultValue={(banks.find((b) => /bank/i.test(b.name)) ?? banks[0])?.id} options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} className="md:col-span-2" />
                </>
              ) : (
                <p className="text-xs text-muted-foreground md:col-span-2">Only accounting users can book the payment; this records the new date only.</p>
              )}
              <Field label="Note" name="note" className="md:col-span-2" placeholder="Order number, invoice no., …" />
              <div>
                <SubmitButton>Record renewal</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        )}

        <Panel title="Renewal history">
          {r.history.length === 0 ? (
            <Empty>Not renewed in the ERP yet.</Empty>
          ) : (
            <T head={["Paid", "Period", <span key="a" className="block text-right">Amount</span>, ""]}>
              {r.history.map((h) => (
                <tr key={h.id}>
                  <td className={td}>{fmtDate(h.paidOn)}</td>
                  <td className={td}>
                    {fmtDate(h.periodFrom)} → {fmtDate(h.periodTo)}
                    <div className="text-xs text-muted-foreground">
                      {daysBetween(h.periodFrom, h.periodTo)} days{h.note ? ` · ${h.note}` : ""}
                    </div>
                  </td>
                  <td className={tdNum}>
                    <Money value={h.amount + h.gstAmount} />
                    {h.gstAmount > 0 && <div className="text-xs text-muted-foreground">incl. GST <Money value={h.gstAmount} /></div>}
                  </td>
                  <td className={td}>{h.expenseId ? <Link href="/accounting/expenses" className="text-xs text-primary hover:underline">expense</Link> : <span className="text-xs text-muted-foreground">not booked</span>}</td>
                </tr>
              ))}
            </T>
          )}
        </Panel>

        {writable && (
          <Panel title="Details" className="lg:col-span-2">
            <ActionForm key={r.updatedAt.getTime()} action={saveRenewal} resetOnSuccess={false} className="grid gap-3 md:grid-cols-4">
              <input type="hidden" name="id" value={r.id} />
              <RenewalFields
                d={{ ...r, startDate: isoDate(r.startDate), renewalDate: day(r.renewalDate) }}
                vendors={vendors}
                projects={projects}
                accounts={accounts.filter((a) => a.type === "EXPENSE")}
              />
              <div>
                <SubmitButton>Save</SubmitButton>
              </div>
            </ActionForm>
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <ActionForm action={setStatusAction}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="status" value={active ? "CANCELLED" : "ACTIVE"} />
                <SubmitButton variant="outline">{active ? "Mark as cancelled (not renewing)" : "Reactivate"}</SubmitButton>
              </ActionForm>
              {r.history.length === 0 && (
                <ActionForm action={deleteAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="destructive">Delete</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
