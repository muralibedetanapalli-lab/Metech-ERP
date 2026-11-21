import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageHeader, Panel, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms";
import { saveCostCentre } from "../actions";

export const metadata = { title: "Projects & cost centres" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const [centres, sums] = await Promise.all([
    db.costCentre.findMany({ orderBy: { code: "asc" } }),
    db.journalLine.groupBy({ by: ["costCentreId", "accountId"], where: { costCentreId: { not: null }, entry: { voided: false } }, _sum: { debit: true, credit: true } }),
  ]);
  const accounts = await db.account.findMany({ where: { id: { in: [...new Set(sums.map((s) => s.accountId))] } }, select: { id: true, type: true } });
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const totals = (id: string) => {
    let income = 0;
    let cost = 0;
    for (const s of sums.filter((x) => x.costCentreId === id)) {
      const net = (s._sum.debit ?? 0) - (s._sum.credit ?? 0);
      if (type.get(s.accountId) === "INCOME") income -= net;
      if (type.get(s.accountId) === "EXPENSE") cost += net;
    }
    return { income, cost };
  };
  return (
    <>
      <PageHeader title="Projects & cost centres" description="Tag invoices, bills, expenses and journal lines with a project or department to see its income, cost and margin." />
      {can(user.role, "erp.write") && (
        <Panel title="New project / cost centre" className="mb-6">
          <ActionForm action={saveCostCentre} className="grid gap-3 md:grid-cols-6">
            <Field label="Code" name="code" required placeholder="DUKAAN" />
            <Field label="Name" name="name" required className="md:col-span-2" placeholder="Dukaan Express platform" />
            <SelectField label="Kind" name="kind" options={["PROJECT", "DEPARTMENT", "BRANCH"].map((k) => ({ value: k, label: k.toLowerCase() }))} />
            <Field label="Budget (₹)" name="budget" inputMode="decimal" />
            <div className="self-end">
              <SubmitButton>Add</SubmitButton>
            </div>
            <Field label="Start" name="startDate" type="date" />
            <Field label="End" name="endDate" type="date" />
          </ActionForm>
        </Panel>
      )}
      {centres.length === 0 ? (
        <Empty>No projects or cost centres yet.</Empty>
      ) : (
        <T head={["Code", "Name", "Kind", "Period", <span key="b" className="block text-right">Budget</span>, <span key="i" className="block text-right">Income</span>, <span key="c" className="block text-right">Cost</span>, <span key="m" className="block text-right">Margin</span>]}>
          {centres.map((c) => {
            const t = totals(c.id);
            return (
              <tr key={c.id}>
                <td className={td}>{c.code}</td>
                <td className={td}>
                  {c.name}
                </td>
                <td className={td}>
                  <Pill>{c.kind.toLowerCase()}</Pill>
                </td>
                <td className={td}>{c.startDate ? `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}` : "—"}</td>
                <td className={tdNum}>{c.budget ? <Money value={c.budget} /> : "—"}</td>
                <td className={tdNum}>
                  <Money value={t.income} />
                </td>
                <td className={tdNum}>
                  <Money value={t.cost} className={c.budget && t.cost > c.budget ? "text-destructive" : ""} />
                </td>
                <td className={tdNum}>
                  <Money value={t.income - t.cost} />
                </td>
              </tr>
            );
          })}
        </T>
      )}
    </>
  );
}
