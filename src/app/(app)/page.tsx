import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { accountSums, naturalBalance, profitAndLoss } from "@/server/accounting/reports";
import { dateRange, hoursFromNow, monthStartIso, todayIso } from "@/lib/dates";
import { timeLeft, urgencyTone } from "@/lib/renewals";
import { Empty, Money, PageHeader, Panel, Pill, Stat, fmtDate } from "@/components/page";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  const month = dateRange({}, { from: monthStartIso() });
  const fy = dateRange({});
  const [sums, monthPl, fyPl, openDeals, dueTasks, recent, lastSync, dukaanParties, renewals] = await Promise.all([
    accountSums({}),
    profitAndLoss(month.from, month.to),
    profitAndLoss(fy.from, fy.to),
    db.deal.aggregate({ where: { stage: { outcome: "OPEN" } }, _sum: { value: true }, _count: true }),
    db.activity.findMany({
      where: { doneAt: null, dueAt: { lte: hoursFromNow(24) } },
      include: { party: { select: { id: true, name: true } } },
      orderBy: { dueAt: "asc" },
      take: 8,
    }),
    db.journalEntry.findMany({ where: { voided: false }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8 }),
    db.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    db.party.groupBy({ by: ["extType"], where: { extSource: "DUKAAN" }, _count: true }),
    db.renewal.findMany({ where: { status: "ACTIVE" }, orderBy: { renewalDate: "asc" }, take: 200 }),
  ]);
  const today = todayIso();
  const renewalsDue = renewals.map((r) => ({ ...r, left: timeLeft(r.renewalDate, today, r.remindDays) })).filter((r) => r.left.urgency !== "ok");
  const bal = (pred: (a: (typeof sums)[number]) => boolean) => sums.filter(pred).reduce((s, a) => s + naturalBalance(a), 0);
  const cash = bal((a) => a.subtype === "BANK" || a.subtype === "CASH");
  const receivable = bal((a) => a.subtype === "RECEIVABLE");
  const payable = bal((a) => a.code === "2000");
  const dukaanPayable = bal((a) => a.code === "2300" || a.code === "2310" || a.code === "2320");
  const commissionMonth = monthPl.income.find((a) => a.code === "4100")?.amount ?? 0;

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} description="Metech Solutions at a glance" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cash & bank" value={<Money value={cash} compact />} href="/accounting/accounts" />
        <Stat label="Receivables" value={<Money value={receivable} compact />} href="/reports/receivables" />
        <Stat label="Payables" value={<Money value={payable} compact />} href="/reports/payables" />
        <Stat label="Owed to Dukaan shops, riders & dealers" value={<Money value={dukaanPayable} compact />} href="/integrations/dukaan" />
        <Stat label="Income this month" value={<Money value={monthPl.totalIncome} compact />} href="/reports/profit-loss" />
        <Stat label="Dukaan commission this month" value={<Money value={commissionMonth} compact />} href="/reports/profit-loss" />
        <Stat label="Net profit (FY to date)" value={<Money value={fyPl.netProfit} compact />} tone={fyPl.netProfit >= 0 ? "good" : "bad"} href="/reports/profit-loss" />
        <Stat label="Open deals" value={<Money value={openDeals._sum.value ?? 0} compact />} hint={`${openDeals._count} deals`} href="/crm/deals" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Tasks & follow-ups due" actions={<Link href="/crm/tasks" className="text-xs text-primary">All tasks</Link>}>
          {dueTasks.length === 0 ? (
            <Empty>Nothing due. Nice.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {dueTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">{t.subject}</div>
                    {t.party && (
                      <Link href={`/crm/contacts/${t.party.id}`} className="text-xs text-muted-foreground hover:underline">
                        {t.party.name}
                      </Link>
                    )}
                  </div>
                  <Pill tone={t.dueAt && t.dueAt < new Date() ? "red" : "amber"}>{fmtDate(t.dueAt)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent journal entries" actions={<Link href="/accounting/journal" className="text-xs text-primary">Journal</Link>}>
          {recent.length === 0 ? (
            <Empty>No entries yet. Create an invoice or run the Dukaan sync.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {recent.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/accounting/journal/${e.id}`} className="min-w-0 truncate hover:underline">
                    {e.narration}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Renewals due" actions={<Link href="/erp/renewals" className="text-xs text-primary">All renewals</Link>} className="lg:col-span-2">
          {renewalsDue.length === 0 ? (
            <Empty>{renewals.length ? "Nothing to renew soon." : "Track domains, hosting and subscriptions under ERP → Renewals."}</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {renewalsDue.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/erp/renewals/${r.id}`} className="min-w-0 truncate font-medium hover:underline">
                    {r.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtDate(r.renewalDate)}</span>
                  </Link>
                  <Pill tone={urgencyTone(r.left.urgency)}>{r.left.label}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Dukaan Express" actions={<Link href="/integrations/dukaan" className="text-xs text-primary">Sync settings</Link>} className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {lastSync ? (
              <>
                <Pill tone={lastSync.ok ? "green" : lastSync.finishedAt ? "red" : "amber"}>{lastSync.ok ? "Last sync OK" : lastSync.finishedAt ? "Last sync failed" : "Sync running"}</Pill>
                <span className="text-muted-foreground">
                  {fmtDate(lastSync.startedAt)} · {lastSync.parties} records, {lastSync.posted} entries posted
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Not synced yet.</span>
            )}
            {dukaanParties.map((g) => (
              <Pill key={g.extType} tone="blue">
                {g._count} {g.extType?.toLowerCase().replace("_", " ")}s
              </Pill>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
