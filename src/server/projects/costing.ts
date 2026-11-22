import "server-only";
import { db } from "@/server/db";

export interface ProjectCostRow {
  id: string;
  code: string;
  name: string;
  revenue: number;
  directCost: number;
  /** Share of shared costs, in basis points of the total (by revenue). */
  shareBps: number;
  sharedCost: number;
  totalCost: number;
  profit: number;
  budget: number | null;
}

export interface ProjectCosting {
  rows: ProjectCostRow[];
  /** Expenses not tagged to any project (no cost centre, or a department / branch): split across projects. */
  sharedCost: number;
  /** Shared cost that could not be split because no project had revenue in the period. */
  unallocated: number;
  /** Income not tagged to a project; shown, never split. */
  untaggedIncome: number;
}

/** Split `total` by integer weights so the parts add up exactly (largest remainder). */
export function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.trunc(r));
  let rest = total - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest !== 0 && k < order.length; k++) {
    parts[order[k].i] += Math.sign(rest);
    rest -= Math.sign(rest);
  }
  return parts;
}

/**
 * Overall project cost for a period: revenue and direct costs come from journal lines tagged with the project
 * (its invoices, bills, expenses and synced postings); shared costs (everything untagged, plus departments and
 * branches) are split across projects in proportion to their revenue. Projects with no revenue take no share.
 */
export async function projectCosting(from: Date, to: Date): Promise<ProjectCosting> {
  const [centres, sums, accounts] = await Promise.all([
    db.costCentre.findMany({ orderBy: { code: "asc" } }),
    db.journalLine.groupBy({ by: ["costCentreId", "accountId"], where: { entry: { voided: false, date: { gte: from, lte: to } } }, _sum: { debit: true, credit: true } }),
    db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, type: true } }),
  ]);
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const per = new Map<string | null, { income: number; expense: number }>();
  for (const s of sums) {
    const t = type.get(s.accountId);
    if (!t) continue;
    const g = per.get(s.costCentreId) ?? { income: 0, expense: 0 };
    const net = (s._sum.debit ?? 0) - (s._sum.credit ?? 0);
    if (t === "INCOME") g.income -= net;
    else g.expense += net;
    per.set(s.costCentreId, g);
  }
  const projects = centres.filter((c) => c.kind === "PROJECT");
  const projectIds = new Set(projects.map((p) => p.id));
  let sharedCost = 0;
  let untaggedIncome = 0;
  for (const [id, g] of per) {
    if (id && projectIds.has(id)) continue;
    sharedCost += g.expense;
    untaggedIncome += g.income;
  }
  const revenue = projects.map((p) => per.get(p.id)?.income ?? 0);
  const weights = revenue.map((r) => Math.max(0, r));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const shares = splitByWeight(sharedCost, weights);
  const rows = projects.map((p, i) => {
    const directCost = per.get(p.id)?.expense ?? 0;
    const totalCost = directCost + shares[i];
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      revenue: revenue[i],
      directCost,
      shareBps: totalWeight > 0 ? Math.round((weights[i] * 10_000) / totalWeight) : 0,
      sharedCost: shares[i],
      totalCost,
      profit: revenue[i] - totalCost,
      budget: p.budget,
    };
  });
  return { rows, sharedCost, unallocated: totalWeight > 0 ? 0 : sharedCost, untaggedIncome };
}

/** Income and expense by account for one project (for its page). */
export async function projectAccounts(projectId: string, from: Date, to: Date) {
  const sums = await db.journalLine.groupBy({ by: ["accountId"], where: { costCentreId: projectId, entry: { voided: false, date: { gte: from, lte: to } } }, _sum: { debit: true, credit: true } });
  const accounts = await db.account.findMany({ where: { id: { in: sums.map((s) => s.accountId) }, type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, code: true, name: true, type: true } });
  return accounts
    .map((a) => {
      const s = sums.find((x) => x.accountId === a.id)!;
      const net = (s._sum.debit ?? 0) - (s._sum.credit ?? 0);
      return { ...a, amount: a.type === "INCOME" ? -net : net };
    })
    .filter((a) => a.amount !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}
