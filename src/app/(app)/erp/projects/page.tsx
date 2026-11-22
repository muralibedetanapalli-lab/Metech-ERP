import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { projectCosting } from "@/server/projects/costing";
import { projectConfigured } from "@/server/projects/sync";
import { can } from "@/lib/permissions";
import { dateRange, fyStartIso } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, Pill, Stat, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCostCentre } from "../actions";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  const r = dateRange(await searchParams, { from: fyStartIso() });
  const [centres, costing] = await Promise.all([db.costCentre.findMany({ orderBy: [{ kind: "asc" }, { code: "asc" }] }), projectCosting(r.from, r.to)]);
  const row = new Map(costing.rows.map((x) => [x.id, x]));
  const projects = centres.filter((c) => c.kind === "PROJECT");
  const others = centres.filter((c) => c.kind !== "PROJECT");
  const revenue = costing.rows.reduce((s, x) => s + x.revenue, 0);
  const profit = costing.rows.reduce((s, x) => s + x.profit, 0);
  return (
    <>
      <PageHeader
        title="Projects"
        description="Each business line (Dukaan Express, TentOs, …) is a project. Its invoices, bills, expenses and synced postings are tagged with it; shared company costs are split across projects by revenue share."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/reports/project-costing?from=${r.fromIso}&to=${r.toIso}`}>Costing report</Link>
          </Button>
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
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Project revenue" value={<Money value={revenue} />} />
        <Stat label="Shared costs split" value={<Money value={costing.sharedCost} />} hint={costing.unallocated ? "Not split: no project revenue yet" : "by revenue share"} />
        <Stat label="Project profit" value={<Money value={profit} />} tone={profit >= 0 ? "good" : "bad"} />
        <Stat label="Income not tagged" value={<Money value={costing.untaggedIncome} />} hint="tag invoices with a project" />
      </div>
      {projects.length === 0 ? (
        <Empty>No projects yet.</Empty>
      ) : (
        <T
          head={[
            "Project",
            "Connection",
            <span key="r" className="block text-right">Revenue</span>,
            <span key="d" className="block text-right">Direct cost</span>,
            <span key="s" className="block text-right">Shared cost</span>,
            <span key="t" className="block text-right">Total cost</span>,
            <span key="p" className="block text-right">Profit</span>,
            <span key="m" className="block text-right">Margin</span>,
          ]}
        >
          {projects.map((c) => {
            const x = row.get(c.id)!;
            return (
              <tr key={c.id} className="hover:bg-muted/30">
                <td className={td}>
                  <Link href={`/erp/projects/${c.id}`} className="font-medium text-primary hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {c.code}
                    {!c.active && " · inactive"}
                  </div>
                </td>
                <td className={td}>
                  {c.connector ? (
                    <div className="grid gap-0.5">
                      <Pill tone={projectConfigured(c) ? (c.syncEnabled ? "green" : "blue") : "red"}>{c.connector === "DUKAAN" ? "Dukaan feed" : "Project feed"}</Pill>
                      <span className="text-xs text-muted-foreground">{c.lastSyncAt ? `synced ${fmtDate(c.lastSyncAt)}` : "never synced"}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">manual</span>
                  )}
                </td>
                <td className={tdNum}>
                  <Money value={x.revenue} />
                </td>
                <td className={tdNum}>
                  <Money value={x.directCost} />
                </td>
                <td className={tdNum}>
                  <Money value={x.sharedCost} />
                  <div className="text-xs text-muted-foreground">{(x.shareBps / 100).toFixed(1)}%</div>
                </td>
                <td className={tdNum}>
                  <Money value={x.totalCost} className={c.budget && x.totalCost > c.budget ? "text-destructive" : ""} />
                  {c.budget ? <div className="text-xs text-muted-foreground">budget <Money value={c.budget} /></div> : null}
                </td>
                <td className={tdNum}>
                  <Money value={x.profit} className={x.profit < 0 ? "text-destructive" : ""} />
                </td>
                <td className={tdNum}>{x.revenue > 0 ? `${((x.profit * 100) / x.revenue).toFixed(1)}%` : "—"}</td>
              </tr>
            );
          })}
        </T>
      )}
      {others.length > 0 && (
        <Panel title="Departments & branches (their costs count as shared costs)" className="mt-6">
          <ul className="grid gap-1 text-sm">
            {others.map((c) => (
              <li key={c.id}>
                <Link href={`/erp/projects/${c.id}`} className="text-primary hover:underline">
                  {c.code} · {c.name}
                </Link>{" "}
                <Pill>{c.kind.toLowerCase()}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {can(user.role, "erp.write") && (
        <Panel title="New project, department or branch" className="mt-6">
          <ActionForm action={saveCostCentre} className="grid gap-3 md:grid-cols-6">
            <Field label="Code" name="code" required placeholder="TENTOS" />
            <Field label="Name" name="name" required className="md:col-span-2" placeholder="TentOs" />
            <SelectField label="Kind" name="kind" options={["PROJECT", "DEPARTMENT", "BRANCH"].map((k) => ({ value: k, label: k.toLowerCase() }))} />
            <Field label="Budget (₹)" name="budget" inputMode="decimal" />
            <div className="self-end">
              <SubmitButton>Add</SubmitButton>
            </div>
            <Field label="Start" name="startDate" type="date" />
            <Field label="End" name="endDate" type="date" />
          </ActionForm>
          <p className="mt-2 text-xs text-muted-foreground">After adding a project, open it to connect its app (project feed) for automatic sync.</p>
        </Panel>
      )}
    </>
  );
}
