import "server-only";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { postEntry, type LineInput } from "@/server/accounting/ledger";

/** PF: 12% of basic, capped at the ₹15,000 wage ceiling (employee and employer each). */
export const PF_RATE_BPS = 1200;
export const PF_WAGE_CEILING = 15_000_00;

/** Telangana professional tax slab (monthly): up to ₹15,000 nil, ₹15,001–20,000 ₹150, above ₹200. */
export function professionalTax(gross: number) {
  if (gross <= 15_000_00) return 0;
  if (gross <= 20_000_00) return 150_00;
  return 200_00;
}

export function computePayslip(e: { basic: number; hra: number; otherAllow: number; pfApplicable: boolean }) {
  const gross = e.basic + e.hra + e.otherAllow;
  const pf = e.pfApplicable ? Math.round((Math.min(e.basic, PF_WAGE_CEILING) * PF_RATE_BPS) / 10_000) : 0;
  const pt = professionalTax(gross);
  return { gross, pfEmployee: pf, pfEmployer: pf, professionalTax: pt, tds: 0, net: gross - pf - pt };
}

/**
 * Basic monthly payroll: one payslip per active employee and one journal entry:
 * Dr Salaries (gross) + Dr Employer PF / Cr Salaries payable (net) + Cr PF payable (both shares) + Cr PT payable.
 * Pay the salaries later with a Payment against "Salaries payable".
 */
export async function runPayroll(period: string, userId?: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError(400, "PERIOD", "Month must look like 2026-11");
  const [y, m] = period.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0));
  return db.$transaction(async (tx) => {
    const employees = await tx.employee.findMany({ where: { active: true, joinDate: { lte: monthEnd } } });
    if (!employees.length) throw new AppError(400, "NO_EMPLOYEES", "No active employees for this month");
    if (await tx.payslip.findFirst({ where: { period } })) throw new AppError(409, "DONE", `Payroll for ${period} has already been run`);
    let gross = 0, pfE = 0, pfR = 0, pt = 0, net = 0;
    for (const e of employees) {
      const s = computePayslip(e);
      await tx.payslip.create({ data: { employeeId: e.id, period, gross: s.gross, pfEmployee: s.pfEmployee, professionalTax: s.professionalTax, tds: s.tds, net: s.net } });
      gross += s.gross;
      pfE += s.pfEmployee;
      pfR += s.pfEmployer;
      pt += s.professionalTax;
      net += s.net;
    }
    const lines: LineInput[] = [
      { key: "SALARIES", amount: gross, memo: `Salaries ${period}` },
      { key: "EMPLOYER_PF", amount: pfR, memo: `Employer PF ${period}` },
      { key: "SALARY_PAYABLE", amount: -net },
      { key: "PF_PAYABLE", amount: -(pfE + pfR) },
      { key: "PT_PAYABLE", amount: -pt },
    ];
    const { entry } = await postEntry(tx, { date: monthEnd, narration: `Payroll ${period} (${employees.length} employees)`, source: "MANUAL", sourceRef: `payroll:${period}`, createdById: userId, lines });
    return { period, count: employees.length, gross, net, entryId: entry.id };
  });
}
