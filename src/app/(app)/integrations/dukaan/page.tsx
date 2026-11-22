import Link from "next/link";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireUser } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { dukaanConfigured } from "@/server/dukaan/sync";
import { accountSums, naturalBalance } from "@/server/accounting/reports";
import { can } from "@/lib/permissions";
import { Empty, Money, PageHeader, Panel, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, SelectField, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { SyncButton } from "./sync-button";
import { resetCursor, saveDukaanSettings, syncNow } from "./actions";

export const metadata = { title: "Dukaan Express sync" };

const TYPES = [
  ["SHOP", "Shops", "dukaan-shop"],
  ["SHOP_OWNER", "Shop owners", "dukaan-owner"],
  ["DEALER", "Dealers", "dukaan-dealer"],
  ["RIDER", "Riders", "dukaan-rider"],
  ["CUSTOMER", "Customers", "dukaan-customer"],
] as const;

export default async function DukaanPage() {
  const user = await requireUser();
  const e = env();
  const configured = dukaanConfigured();
  const [runs, counts, cursors, company, banks, sums, entries] = await Promise.all([
    db.syncRun.findMany({ where: { project: { connector: "DUKAAN" } }, orderBy: { startedAt: "desc" }, take: 10 }),
    db.party.groupBy({ by: ["extType"], where: { extSource: "DUKAAN" }, _count: true }),
    db.syncCursor.findMany({ where: { feed: { in: ["parties", "events"] } } }),
    db.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} }),
    lookups.bankAccounts(),
    accountSums({}),
    db.journalEntry.count({ where: { source: "DUKAAN", voided: false } }),
  ]);
  const bal = (code: string) => {
    const a = sums.find((s) => s.code === code);
    return a ? naturalBalance(a) : 0;
  };
  return (
    <>
      <PageHeader
        title="Dukaan Express sync"
        description="Pulls shops, owners, dealers, riders and customers into the CRM, and delivered orders, refunds and payouts into the books."
        actions={can(user.role, "dukaan.sync") && <SyncButton action={syncNow} disabled={!configured} />}
      />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Panel title="Connection">
          <div className="grid gap-1 text-sm">
            <div className="flex items-center gap-2">
              <Pill tone={configured ? "green" : "red"}>{configured ? "Configured" : "Not configured"}</Pill>
            </div>
            <div className="text-muted-foreground">Dukaan URL: {e.DUKAAN_BASE_URL ?? "—"}</div>
            <div className="text-muted-foreground">Service key: {e.DUKAAN_API_KEY ? "set" : "missing"}</div>
            <div className="text-muted-foreground">Scheduled sync: {e.CRON_SECRET ? "enabled (POST /api/integrations/dukaan/sync)" : "off (no CRON_SECRET)"}</div>
          </div>
        </Panel>
        <Panel title="Marketplace balances in the books">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt>Cashfree clearing</dt>
            <dd className="text-right">
              <Money value={bal("1400")} />
            </dd>
            <dt>Payable to shops</dt>
            <dd className="text-right">
              <Money value={bal("2300")} />
            </dd>
            <dt>Rider wallets</dt>
            <dd className="text-right">
              <Money value={bal("2310")} />
            </dd>
            <dt>Dealer commission</dt>
            <dd className="text-right">
              <Money value={bal("2320")} />
            </dd>
          </dl>
          <Link href="/accounting/journal?source=DUKAAN" className="mt-2 block text-xs text-primary">
            {entries} Dukaan journal entries →
          </Link>
        </Panel>
        <Panel title="Synced records">
          <ul className="grid gap-1 text-sm">
            {TYPES.map(([t, label, f]) => (
              <li key={t} className="flex justify-between">
                <Link href={`/crm/contacts?f=${f}`} className="text-primary hover:underline">
                  {label}
                </Link>
                <span>{counts.find((c) => c.extType === t)?._count ?? 0}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {can(user.role, "admin") && (
        <Panel title="Posting settings" className="mb-6">
          <ActionForm action={saveDukaanSettings} resetOnSuccess={false} className="grid gap-3 md:grid-cols-3">
            <SelectField
              label="Bank account that pays Dukaan payouts"
              name="dukaanPayoutAccountId"
              defaultValue={company.dukaanPayoutAccountId ?? ""}
              placeholder="Default: 1010 Bank — current account"
              options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))}
            />
            <SelectField
              label="GST included in platform commission"
              name="commissionGstBps"
              defaultValue={String(company.commissionGstBps)}
              options={[{ value: "0", label: "None — book commission as is" }, { value: "1800", label: "18% (split into CGST + SGST)" }]}
            />
            <div className="self-end">
              <SubmitButton>Save</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}

      <Panel title="How Dukaan money is booked" className="mb-6">
        <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            <b className="text-foreground">Order delivered</b>: online payments debit Cashfree clearing; COD collected by a Dukaan rider debits that rider&apos;s wallet. The shop&apos;s earning is credited to <i>payable to shops</i>, the rider&apos;s fee to <i>rider wallets</i>, and the platform commission to income. Anything left (delivery fee minus rider fee) goes to delivery income or cost. The dealer&apos;s share is booked as dealer commission expense and payable.
          </li>
          <li>
            <b className="text-foreground">Shop settlement, dealer payout or rider withdrawal paid</b>: debit the payable, credit the payout bank account.
          </li>
          <li>
            <b className="text-foreground">Refund on a delivered order</b>: debit refunds expense, credit Cashfree clearing. Refunds of undelivered orders have no effect: their collection was never booked.
          </li>
          <li>
            <b className="text-foreground">Cashfree settlements</b> reaching the bank: reconcile them on the Bank reconciliation page against <i>Cashfree clearing</i>.
          </li>
          <li>Every event posts once (keyed by its Dukaan id), so re-running the sync is always safe.</li>
        </ul>
      </Panel>

      <Panel
        title="Recent sync runs"
        actions={
          can(user.role, "admin") && (
            <div className="flex gap-2 text-xs text-muted-foreground">
              {cursors.map((c) => (
                <form key={c.feed} action={resetCursor}>
                  <input type="hidden" name="feed" value={c.feed} />
                  <Button size="xs" variant="ghost" type="submit" title={`Cursor ${c.cursor ?? "start"}`}>
                    Re-read {c.feed} from start
                  </Button>
                </form>
              ))}
            </div>
          )
        }
      >
        {runs.length === 0 ? (
          <Empty>No sync has run yet.</Empty>
        ) : (
          <T head={["Started", "Trigger", "Result", <span key="p" className="block text-right">Contacts</span>, <span key="e" className="block text-right">Events</span>, <span key="o" className="block text-right">Posted</span>]}>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  {fmtDate(r.startedAt)} {r.startedAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className={td}>{r.trigger.toLowerCase()}</td>
                <td className={td}>
                  {r.ok ? <Pill tone="green">OK</Pill> : r.finishedAt ? <Pill tone="red">Failed</Pill> : <Pill tone="amber">Running</Pill>}
                  {r.error && <div className="mt-1 max-w-md text-xs text-destructive">{r.error}</div>}
                </td>
                <td className={tdNum}>{r.parties}</td>
                <td className={tdNum}>{r.events}</td>
                <td className={tdNum}>{r.posted}</td>
              </tr>
            ))}
          </T>
        )}
      </Panel>
    </>
  );
}
