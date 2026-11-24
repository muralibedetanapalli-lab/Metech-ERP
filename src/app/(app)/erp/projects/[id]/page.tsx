import Link from "next/link";
import { COMMON_KIND } from "@/lib/cost-centres";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { lookups } from "@/server/lookups";
import { projectAccounts, projectCosting } from "@/server/projects/costing";
import { projectConfigured } from "@/server/projects/sync";
import { can } from "@/lib/permissions";
import { dateRange, fyStartIso } from "@/lib/dates";
import { docLabel, docSign, statusLabel } from "@/lib/doc-types";
import { Empty, Money, PageHeader, Panel, Pill, Stat, T, fmtDate, isoDate, statusTone, td, tdNum } from "@/components/page";
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from "@/components/forms";
import { ActionButton } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetFeed, saveConnection, syncProjectNow, testConnection, updateProject } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.costCentre.findUnique({ where: { id }, select: { name: true } });
  return { title: p?.name ?? "Project" };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const p = await db.costCentre.findUnique({ where: { id } });
  if (!p) notFound();
  const r = dateRange(await searchParams, { from: fyStartIso() });
  const [costing, accounts, invoices, runs, banks, synced] = await Promise.all([
    projectCosting(r.from, r.to),
    projectAccounts(id, r.from, r.to),
    db.invoice.findMany({ where: { costCentreId: id }, include: { party: { select: { id: true, name: true } } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 15 }),
    db.syncRun.findMany({ where: { projectId: id }, orderBy: { startedAt: "desc" }, take: 8 }),
    lookups.bankAccounts(),
    db.syncEvent.count({ where: { projectId: id } }),
  ]);
  const x = costing.rows.find((row) => row.id === id);
  const project = p.kind === "PROJECT";
  const admin = can(user.role, "admin");
  const configured = projectConfigured(p);
  const income = accounts.filter((a) => a.type === "INCOME");
  const expense = accounts.filter((a) => a.type === "EXPENSE");
  return (
    <>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill>{p.kind.toLowerCase()}</Pill> {p.code}
            {p.description && <span>· {p.description}</span>}
          </span>
        }
        actions={
          <>
            {p.connector && can(user.role, "dukaan.sync") && <ActionButton action={syncProjectNow.bind(null, p.id)} label="Sync now" disabled={!configured} />}
            <Button variant="outline" asChild>
              <Link href={`/accounting/invoices/new?kind=SALES`}>New invoice</Link>
            </Button>
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">From</span>
        <Input type="date" name="from" defaultValue={r.fromIso} className="w-40" />
        <span className="text-muted-foreground">To</span>
        <Input type="date" name="to" defaultValue={r.toIso} className="w-40" />
        <Button type="submit" variant="outline">
          Update
        </Button>
      </form>

      {project && x ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Revenue" value={<Money value={x.revenue} />} />
          <Stat label="Direct cost" value={<Money value={x.directCost} />} />
          <Stat label={`Shared cost (${(x.shareBps / 100).toFixed(1)}%)`} value={<Money value={x.sharedCost} />} hint="share of untagged company costs" />
          <Stat label="Overall cost" value={<Money value={x.totalCost} />} hint={p.budget ? <>budget <Money value={p.budget} /></> : undefined} tone={p.budget && x.totalCost > p.budget ? "bad" : undefined} />
          <Stat label="Profit" value={<Money value={x.profit} />} hint={x.revenue > 0 ? `${((x.profit * 100) / x.revenue).toFixed(1)}% margin` : undefined} tone={x.profit >= 0 ? "good" : "bad"} />
        </div>
      ) : (
        <p className="mb-6 text-sm text-muted-foreground">This is a {p.kind.toLowerCase()}: its costs are shared costs, split across projects by revenue.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Income & cost by account">
          {accounts.length === 0 ? (
            <Empty>Nothing tagged to this {p.kind.toLowerCase()} in the period.</Empty>
          ) : (
            <T head={["Account", <span key="a" className="block text-right">Amount</span>]}>
              {[...income, ...expense].map((a) => (
                <tr key={a.id}>
                  <td className={td}>
                    <Link href={`/accounting/ledger?accountId=${a.id}&from=${r.fromIso}&to=${r.toIso}`} className="hover:underline">
                      {a.code} · {a.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{a.type === "INCOME" ? "income" : "cost"}</span>
                  </td>
                  <td className={tdNum}>
                    <Money value={a.amount} />
                  </td>
                </tr>
              ))}
            </T>
          )}
        </Panel>
        <Panel title="Recent invoices, bills and notes">
          {invoices.length === 0 ? (
            <Empty>No documents tagged with this project yet. Choose it under “Project / cost centre” on an invoice or bill.</Empty>
          ) : (
            <T head={["Number", "Party", "Date", "Status", <span key="t" className="block text-right">Total</span>]}>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className={td}>
                    <Link href={`/accounting/invoices/${i.id}`} className="text-primary hover:underline">
                      {i.number}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {i.kind === "SALES" ? "Sales" : "Purchase"} {docLabel(i.kind, i.docType, true).toLowerCase()}
                    </div>
                  </td>
                  <td className={td}>{i.party.name}</td>
                  <td className={td}>{fmtDate(i.date)}</td>
                  <td className={td}>
                    <Pill tone={statusTone(i.status)}>{statusLabel(i.docType, i.status)}</Pill>
                  </td>
                  <td className={tdNum}>
                    <Money value={docSign(i.docType) * i.total} />
                  </td>
                </tr>
              ))}
            </T>
          )}
        </Panel>

        {project && (
          <Panel title="App connection">
            {p.connector === "DUKAAN" ? (
              <div className="grid gap-2 text-sm">
                <p>
                  Connected to Dukaan Express with its own feed. URL and key are set in the server environment; see{" "}
                  <Link href="/integrations/dukaan" className="text-primary hover:underline">
                    Dukaan Express sync
                  </Link>{" "}
                  for balances and settings.
                </p>
                {admin && (
                  <ActionForm key={String(p.syncEnabled)} action={saveConnection} resetOnSuccess={false} className="flex items-center gap-3">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="syncEnabled" defaultChecked={p.syncEnabled} /> Include in scheduled sync
                    </label>
                    <SubmitButton size="sm" variant="outline">
                      Save
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            ) : (
              <div className="grid gap-3 text-sm">
                <p className="text-muted-foreground">
                  Connect this project&apos;s app with the <strong>Metech project feed</strong> (docs/PROJECT-FEED.md): the app exposes <code>/parties</code> and <code>/events</code>, and the ERP books its invoices, credit/debit notes, bills, payments
                  and expenses here, tagged with {p.code}. Sales documents keep the app&apos;s invoice numbers.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={configured ? (p.syncEnabled ? "green" : "blue") : p.connector ? "red" : "default"}>
                    {configured ? (p.syncEnabled ? "Connected · scheduled sync on" : "Connected · manual sync") : p.connector ? "Incomplete" : "Not connected"}
                  </Pill>
                  {p.lastSyncAt && <span className="text-xs text-muted-foreground">Last sync {fmtDate(p.lastSyncAt)}</span>}
                  <span className="text-xs text-muted-foreground">{synced} events applied</span>
                  {configured && can(user.role, "dukaan.sync") && <ActionButton action={testConnection.bind(null, p.id)} label="Test connection" icon="test" variant="outline" />}
                </div>
                {admin ? (
                  <ActionForm key={`${p.connector}|${p.baseUrl}|${p.bankAccountId}|${p.syncEnabled}|${p.apiKeyEnc ? 1 : 0}`} action={saveConnection} resetOnSuccess={false} className="grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="id" value={p.id} />
                    <SelectField label="Connection" name="connector" defaultValue={p.connector ?? ""} options={[{ value: "", label: "None (manual entries only)" }, { value: "FEED_V1", label: "Metech project feed v1" }]} />
                    <Field label="Feed URL" name="baseUrl" defaultValue={p.baseUrl ?? ""} placeholder="https://tentos.example.com/api/metech-feed/v1" />
                    <Field label={p.apiKeyEnc ? "API key (saved; enter a new one to replace)" : "API key"} name="apiKey" type="password" autoComplete="off" />
                    <SelectField label="Bank account for its payments & expenses" name="bankAccountId" defaultValue={p.bankAccountId ?? ""} placeholder="Default bank account" options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
                    <label className="flex items-center gap-2 self-end">
                      <input type="checkbox" name="syncEnabled" defaultChecked={p.syncEnabled} /> Include in scheduled sync
                    </label>
                    <div className="self-end">
                      <SubmitButton>Save connection</SubmitButton>
                    </div>
                  </ActionForm>
                ) : (
                  <p className="text-xs text-muted-foreground">Only an owner can change the connection.</p>
                )}
                {admin && p.connector === "FEED_V1" && (
                  <form action={resetFeed} className="text-xs text-muted-foreground">
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="text-primary hover:underline">
                      Re-read the feeds from the start
                    </button>{" "}
                    (events already applied are skipped).
                  </form>
                )}
              </div>
            )}
          </Panel>
        )}

        {p.connector && (
          <Panel title="Sync runs">
            {runs.length === 0 ? (
              <Empty>No runs yet.</Empty>
            ) : (
              <T head={["Started", "Trigger", "Result", <span key="p" className="block text-right">Contacts</span>, <span key="e" className="block text-right">Events</span>]}>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className={td}>{run.startedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className={td}>{run.trigger.toLowerCase()}</td>
                    <td className={td}>
                      {!run.finishedAt ? <Pill tone="blue">running</Pill> : run.ok ? <Pill tone="green">ok</Pill> : <Pill tone="red">failed</Pill>}
                      {run.error && <div className="mt-1 max-w-sm text-xs break-words text-destructive">{run.error}</div>}
                    </td>
                    <td className={tdNum}>{run.parties}</td>
                    <td className={tdNum}>
                      {run.events}
                      <div className="text-xs text-muted-foreground">{run.posted} booked</div>
                    </td>
                  </tr>
                ))}
              </T>
            )}
          </Panel>
        )}

        {can(user.role, "erp.write") && (
          <Panel title="Details">
            <ActionForm key={`${p.name}|${p.kind}|${p.active}|${p.budget}|${p.description}|${p.startDate?.getTime()}|${p.endDate?.getTime()}`} action={updateProject} resetOnSuccess={false} className="grid gap-3 md:grid-cols-3">
              <input type="hidden" name="id" value={p.id} />
              <Field label="Name" name="name" defaultValue={p.name} required className="md:col-span-2" />
              {p.kind === COMMON_KIND ? (
                <input type="hidden" name="kind" value={COMMON_KIND} />
              ) : (
                <SelectField label="Kind" name="kind" defaultValue={p.kind} options={["PROJECT", "DEPARTMENT", "BRANCH"].map((k) => ({ value: k, label: k.toLowerCase() }))} />
              )}
              <TextareaField label="Description" name="description" defaultValue={p.description ?? ""} className="md:col-span-3" />
              <Field label="Budget (₹)" name="budget" inputMode="decimal" defaultValue={p.budget ? String(p.budget / 100) : ""} />
              <Field label="Start" name="startDate" type="date" defaultValue={p.startDate ? isoDate(p.startDate) : ""} />
              <Field label="End" name="endDate" type="date" defaultValue={p.endDate ? isoDate(p.endDate) : ""} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={p.active} /> Active
              </label>
              <div className="md:col-span-2">
                <SubmitButton>Save</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        )}
      </div>
    </>
  );
}
