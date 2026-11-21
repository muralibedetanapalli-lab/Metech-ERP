import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { computePayslip } from "@/server/erp/payroll";
import { can } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { payrollAction, saveEmployee } from "../actions";

export const metadata = { title: "Employees & payroll" };

export default async function EmployeesPage() {
  const user = await requireUser();
  const [employees, runs] = await Promise.all([
    db.employee.findMany({ orderBy: { code: "asc" } }),
    db.payslip.groupBy({ by: ["period"], _sum: { gross: true, net: true }, _count: true, orderBy: { period: "desc" }, take: 12 }),
  ]);
  const lastMonth = todayIso().slice(0, 7);
  return (
    <>
      <PageHeader title="Employees & payroll" description="Basic payroll: gross = basic + HRA + allowances; PF 12% of basic (up to ₹15,000); Telangana professional tax. TDS is entered manually for now." />
      {can(user.role, "erp.write") && (
        <Panel title="Add employee" className="mb-6">
          <ActionForm action={saveEmployee} className="grid gap-3 md:grid-cols-4">
            <Field label="Code" name="code" required />
            <Field label="Name" name="name" required />
            <Field label="Designation" name="designation" />
            <Field label="Department" name="department" />
            <Field label="Email" name="email" type="email" />
            <Field label="Phone" name="phone" />
            <Field label="PAN" name="pan" />
            <Field label="Joining date" name="joinDate" type="date" defaultValue={todayIso()} required />
            <Field label="Basic / month (₹)" name="basic" inputMode="decimal" required />
            <Field label="HRA / month (₹)" name="hra" inputMode="decimal" />
            <Field label="Other allowances (₹)" name="otherAllow" inputMode="decimal" />
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="pfApplicable" defaultChecked /> PF applicable
            </label>
            <div>
              <SubmitButton>Add employee</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
      {can(user.role, "accounting.write") && employees.length > 0 && (
        <Panel title="Run payroll" className="mb-6">
          <ActionForm action={payrollAction} className="flex flex-wrap items-end gap-2">
            <Field label="Month" name="period" type="month" defaultValue={lastMonth} required />
            <SubmitButton>Generate payslips & post</SubmitButton>
          </ActionForm>
          {runs.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm">
              {runs.map((r) => (
                <li key={r.period} className="flex justify-between">
                  <span>
                    {r.period} · {r._count} payslips
                  </span>
                  <span>
                    gross <Money value={r._sum.gross} /> · net <Money value={r._sum.net} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {employees.length === 0 ? (
        <Empty>No employees yet.</Empty>
      ) : (
        <T head={["Code", "Name", "Designation", "Joined", <span key="g" className="block text-right">Gross</span>, <span key="p" className="block text-right">PF</span>, <span key="t" className="block text-right">PT</span>, <span key="n" className="block text-right">Net pay</span>]}>
          {employees.map((e) => {
            const s = computePayslip(e);
            return (
              <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                <td className={td}>{e.code}</td>
                <td className={td}>{e.name}</td>
                <td className={td}>{[e.designation, e.department].filter(Boolean).join(" · ") || "—"}</td>
                <td className={td}>{fmtDate(e.joinDate)}</td>
                <td className={tdNum}>
                  <Money value={s.gross} />
                </td>
                <td className={tdNum}>
                  <Money value={s.pfEmployee} />
                </td>
                <td className={tdNum}>
                  <Money value={s.professionalTax} />
                </td>
                <td className={tdNum}>
                  <Money value={s.net} />
                </td>
              </tr>
            );
          })}
        </T>
      )}
    </>
  );
}
