import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { can } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { RENEWAL_CATEGORIES, cycleLabel, termProgress, timeLeft, urgencyTone, yearlyCost, type RenewalCategory } from "@/lib/renewals";
import { Empty, Money, PageHeader, Panel, Pill, Stat, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, SubmitButton } from "@/components/forms";
import { RenewalFields } from "./renewal-fields";
import { saveRenewal } from "./actions";

export const metadata = { title: "Renewals" };

const VIEWS = [
  ["active", "Active"],
  ["due", "Due soon & expired"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<{ view?: string; category?: string; project?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = VIEWS.some(([v]) => v === sp.view) ? sp.view! : "active";
  const category = sp.category && sp.category in RENEWAL_CATEGORIES ? (sp.category as RenewalCategory) : undefined;
  const today = todayIso();
  const [all, vendors, projects, accounts] = await Promise.all([
    db.renewal.findMany({
      where: { ...(category ? { category } : {}), ...(sp.project ? { costCentreId: sp.project === "none" ? null : sp.project } : {}) },
      include: { costCentre: { select: { id: true, code: true, name: true } } },
      orderBy: { renewalDate: "asc" },
    }),
    lookups.parties({ isVendor: true }),
    lookups.costCentres(),
    lookups.accounts(),
  ]);
  const withLeft = all.map((r) => ({ ...r, left: r.status === "CANCELLED" ? { days: 0, label: "Cancelled", urgency: "cancelled" as const } : timeLeft(r.renewalDate, today, r.remindDays) }));
  const active = withLeft.filter((r) => r.status === "ACTIVE");
  const rows = withLeft.filter((r) =>
    view === "all" ? true : view === "cancelled" ? r.status === "CANCELLED" : view === "due" ? r.status === "ACTIVE" && r.left.urgency !== "ok" : r.status === "ACTIVE",
  );
  const dueSoon = active.filter((r) => r.left.urgency === "soon" || r.left.urgency === "due");
  const expired = active.filter((r) => r.left.urgency === "expired");
  const next30 = active.filter((r) => r.left.days >= 0 && r.left.days <= 30);
  const yearly = active.reduce((s, r) => s + yearlyCost(r.amount, r.cycleMonths), 0);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ view, ...(category ? { category } : {}), ...(sp.project ? { project: sp.project } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `?${p}`;
  };
  return (
    <>
      <PageHeader title="Renewals" description="Domains, hosting, SSL, email, software and other services you pay for on a cycle, with the time left before each one must be renewed." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expired" value={expired.length} tone={expired.length ? "bad" : undefined} href={qs({ view: "due" })} />
        <Stat label="Due within reminder window" value={dueSoon.length} hint="red: 7 days or less" href={qs({ view: "due" })} />
        <Stat label="Renewing in next 30 days" value={<Money value={next30.reduce((s, r) => s + r.amount, 0)} />} hint={`${next30.length} item(s), before GST`} />
        <Stat label="Yearly cost (active)" value={<Money value={yearly} />} hint="before GST, all cycles converted to a year" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {VIEWS.map(([v, l]) => (
          <Link key={v} href={qs({ view: v })} className={`rounded-full border px-3 py-1 ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {l}
          </Link>
        ))}
        <span className="mx-1 border-l" />
        <Link href={qs({ category: undefined })} className={`rounded-full border px-3 py-1 ${!category ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          All types
        </Link>
        {Object.entries(RENEWAL_CATEGORIES).map(([c, l]) => (
          <Link key={c} href={qs({ category: c })} className={`rounded-full border px-3 py-1 ${category === c ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {l}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>{all.length ? "Nothing in this view." : "No renewals yet. Add your first domain or subscription below."}</Empty>
      ) : (
        <T head={["Name", "Type", "Project", "Start", "Renewal date", "Time left", <span key="c" className="block text-right">Price / cycle</span>, ""]}>
          {rows.map((r) => {
            const pct = r.status === "ACTIVE" ? termProgress(r, today) : 0;
            const tone = urgencyTone(r.left.urgency);
            return (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className={td}>
                  <Link href={`/erp/renewals/${r.id}`} className="font-medium text-primary hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {[r.provider, r.reference].filter(Boolean).join(" · ") || "—"}
                    {r.autoRenew && " · auto-renew"}
                  </div>
                </td>
                <td className={td}>{RENEWAL_CATEGORIES[r.category as RenewalCategory] ?? r.category}</td>
                <td className={td}>{r.costCentre ? <Link href={`/erp/projects/${r.costCentre.id}`} className="hover:underline">{r.costCentre.code}</Link> : <span className="text-muted-foreground">shared</span>}</td>
                <td className={td}>{fmtDate(r.startDate)}</td>
                <td className={td}>{fmtDate(r.renewalDate)}</td>
                <td className={`${td} min-w-44`}>
                  <Pill tone={tone}>{r.left.label}</Pill>
                  {r.status === "ACTIVE" && (
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" title={`${pct}% of the current term used`}>
                      <div className={`h-full rounded-full ${tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </td>
                <td className={tdNum}>
                  <Money value={r.amount} />
                  <div className="text-xs text-muted-foreground">{cycleLabel(r.cycleMonths).toLowerCase()}</div>
                </td>
                <td className={td}>
                  {r.status === "ACTIVE" && r.left.urgency !== "ok" && (
                    <Link href={`/erp/renewals/${r.id}#renew`} className="text-xs text-primary hover:underline">
                      Renew →
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </T>
      )}

      {can(user.role, "erp.write") && (
        <Panel title="Add a renewal" className="mt-6">
          <ActionForm action={saveRenewal} className="grid gap-3 md:grid-cols-4">
            <RenewalFields d={{ startDate: today }} vendors={vendors} projects={projects} accounts={accounts.filter((a) => a.type === "EXPENSE")} />
            <div>
              <SubmitButton>Add renewal</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
