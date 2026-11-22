import "server-only";
import { docLabel, docSign } from "@/lib/doc-types";
import { db } from "@/server/db";
import type { AccountType } from "@/generated/prisma/client";
import { isDebitNormal } from "./coa";
import { projectCosting } from "@/server/projects/costing";

/** Column spec shared by on-screen tables and Excel/PDF exports. Money values are paise. */
export interface Column {
  key: string;
  label: string;
  money?: boolean;
}
export interface Table {
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  /** Optional bold summary rows shown after the body. */
  totals?: Record<string, string | number | null>[];
}

interface AccountSum {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  debit: number;
  credit: number;
}

/** Sum of debits and credits per account for posted (non-void) entries in a date range. */
export async function accountSums(opts: { from?: Date; to?: Date }): Promise<AccountSum[]> {
  const grouped = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { entry: { voided: false, date: { gte: opts.from, lte: opts.to } } },
    _sum: { debit: true, credit: true },
  });
  const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
  const byId = new Map(grouped.map((g) => [g.accountId, g._sum]));
  return accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    debit: byId.get(a.id)?.debit ?? 0,
    credit: byId.get(a.id)?.credit ?? 0,
  }));
}

/** Natural balance: positive when the account carries its normal side (debit for assets/expenses). */
export const naturalBalance = (a: { type: AccountType; debit: number; credit: number }) =>
  isDebitNormal(a.type) ? a.debit - a.credit : a.credit - a.debit;

export async function trialBalance(asOf: Date) {
  const sums = (await accountSums({ to: asOf })).filter((a) => a.debit || a.credit);
  const rows = sums.map((a) => {
    const net = a.debit - a.credit;
    return { code: a.code, account: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  });
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, debit, credit, balanced: debit === credit };
}

export async function profitAndLoss(from: Date, to: Date) {
  const sums = await accountSums({ from, to });
  const income = sums.filter((a) => a.type === "INCOME").map((a) => ({ ...a, amount: naturalBalance(a) })).filter((a) => a.amount);
  const expense = sums.filter((a) => a.type === "EXPENSE").map((a) => ({ ...a, amount: naturalBalance(a) })).filter((a) => a.amount);
  const totalIncome = income.reduce((s, a) => s + a.amount, 0);
  const totalExpense = expense.reduce((s, a) => s + a.amount, 0);
  return { income, expense, totalIncome, totalExpense, netProfit: totalIncome - totalExpense };
}

export async function balanceSheet(asOf: Date) {
  const sums = await accountSums({ to: asOf });
  const pick = (t: AccountType) => sums.filter((a) => a.type === t).map((a) => ({ ...a, amount: naturalBalance(a) })).filter((a) => a.amount);
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  // Profit not yet closed to retained earnings is shown as part of equity.
  const profit = sums.filter((a) => a.type === "INCOME").reduce((s, a) => s + naturalBalance(a), 0) - sums.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + naturalBalance(a), 0);
  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.amount, 0);
  const totalEquity = equity.reduce((s, a) => s + a.amount, 0) + profit;
  return { assets, liabilities, equity, profit, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

/** GSTR-style summary: outward supplies (sales) vs inward (purchases + expenses), with net liability. */
export async function gstSummary(from: Date, to: Date) {
  const invoices = await db.invoice.findMany({
    where: { status: { not: "VOID" }, date: { gte: from, lte: to } },
    include: { party: { select: { name: true, gstin: true } } },
    orderBy: { date: "asc" },
  });
  const sums = await accountSums({ from, to });
  const bal = (keyCode: string) => sums.find((a) => a.code === keyCode);
  const out = { cgst: bal("2100"), sgst: bal("2101"), igst: bal("2102") };
  const inp = { cgst: bal("1300"), sgst: bal("1301"), igst: bal("1302") };
  const outward = {
    cgst: (out.cgst?.credit ?? 0) - (out.cgst?.debit ?? 0),
    sgst: (out.sgst?.credit ?? 0) - (out.sgst?.debit ?? 0),
    igst: (out.igst?.credit ?? 0) - (out.igst?.debit ?? 0),
  };
  const input = {
    cgst: (inp.cgst?.debit ?? 0) - (inp.cgst?.credit ?? 0),
    sgst: (inp.sgst?.debit ?? 0) - (inp.sgst?.credit ?? 0),
    igst: (inp.igst?.debit ?? 0) - (inp.igst?.credit ?? 0),
  };
  // Credit notes reduce the tax, so they show as negative amounts.
  const rows = invoices.map((i) => {
    const sg = docSign(i.docType);
    const base = i.kind === "SALES" ? "Outward (B2" + (i.party.gstin ? "B)" : "C)") : "Inward";
    return {
      date: i.date.toISOString().slice(0, 10),
      type: i.docType === "INVOICE" ? base : `${base} · ${docLabel(i.kind, i.docType, true).toLowerCase()}`,
      number: i.kind === "SALES" ? i.number : `${i.number}${i.vendorRef ? ` / ${i.vendorRef}` : ""}`,
      party: i.party.name,
      gstin: i.party.gstin ?? "",
      pos: i.placeOfSupply,
      taxable: sg * i.taxableAmount,
      cgst: sg * i.cgst,
      sgst: sg * i.sgst,
      igst: sg * i.igst,
      total: sg * i.total,
    };
  });
  const outTotal = outward.cgst + outward.sgst + outward.igst;
  const inTotal = input.cgst + input.sgst + input.igst;
  return { rows, outward, input, outTotal, inTotal, netPayable: outTotal - inTotal };
}

/** Account or party ledger with opening balance and running balance (debit-positive). */
export async function ledger(opts: { accountId?: string; partyId?: string; from: Date; to: Date }) {
  // A party statement without an account shows its receivable / payable accounts only: income and expense
  // lines are tagged with the party for analysis but are not part of what the party owes.
  const where = {
    ...(opts.accountId ? { accountId: opts.accountId } : opts.partyId ? { account: { subtype: { in: ["RECEIVABLE", "PAYABLE"] } } } : {}),
    ...(opts.partyId ? { partyId: opts.partyId } : {}),
  };
  const opening = await db.journalLine.aggregate({
    where: { ...where, entry: { voided: false, date: { lt: opts.from } } },
    _sum: { debit: true, credit: true },
  });
  const lines = await db.journalLine.findMany({
    where: { ...where, entry: { voided: false, date: { gte: opts.from, lte: opts.to } } },
    include: { entry: true, account: { select: { code: true, name: true } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
  });
  const openingBalance = (opening._sum.debit ?? 0) - (opening._sum.credit ?? 0);
  let running = openingBalance;
  const rows = lines.map((l) => {
    running += l.debit - l.credit;
    return {
      entryId: l.entryId,
      date: l.entry.date.toISOString().slice(0, 10),
      number: l.entry.number,
      account: `${l.account.code} ${l.account.name}`,
      narration: l.memo ? `${l.entry.narration} · ${l.memo}` : l.entry.narration,
      debit: l.debit,
      credit: l.credit,
      balance: running,
    };
  });
  return { openingBalance, rows, closingBalance: running };
}

/** Outstanding invoices by party with simple ageing buckets. Unapplied credit notes show as negative balances. */
export async function outstanding(kind: "SALES" | "PURCHASE", asOf = new Date()) {
  const invoices = await db.invoice.findMany({
    where: { kind, status: { in: ["POSTED", "PARTIAL"] } },
    include: { party: { select: { id: true, name: true } } },
    orderBy: { date: "asc" },
  });
  return invoices.map((i) => {
    const due = i.dueDate ?? i.date;
    const days = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
    const sg = docSign(i.docType);
    return {
      id: i.id,
      number: i.docType === "INVOICE" ? i.number : `${i.number} (${docLabel(i.kind, i.docType, true).toLowerCase()})`,
      party: i.party.name,
      partyId: i.party.id,
      date: i.date.toISOString().slice(0, 10),
      due: due.toISOString().slice(0, 10),
      total: sg * i.total,
      balance: sg * (i.total - i.amountPaid),
      bucket: i.docType === "CREDIT_NOTE" ? "Credit" : days <= 0 ? "Not due" : days <= 30 ? "1–30 days" : days <= 60 ? "31–60 days" : days <= 90 ? "61–90 days" : "90+ days",
    };
  });
}

// ───────────────────────────── Report registry (screens + exports) ─────────────────────────────

export const REPORT_TYPES = ["trial-balance", "profit-loss", "balance-sheet", "gst-summary", "receivables", "payables", "project-costing"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TITLES: Record<ReportType, string> = {
  "trial-balance": "Trial balance",
  "profit-loss": "Profit & loss",
  "balance-sheet": "Balance sheet",
  "gst-summary": "GST summary",
  receivables: "Receivables (debtors)",
  payables: "Payables (creditors)",
  "project-costing": "Project costing",
};

/** Build any report as a flat table for screens and Excel/PDF export. */
export async function buildReport(type: ReportType, from: Date, to: Date): Promise<Table> {
  const period = `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
  switch (type) {
    case "trial-balance": {
      const tb = await trialBalance(to);
      return {
        title: REPORT_TITLES[type],
        subtitle: `As of ${to.toISOString().slice(0, 10)}`,
        columns: [{ key: "code", label: "Code" }, { key: "account", label: "Account" }, { key: "type", label: "Type" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }],
        rows: tb.rows,
        totals: [{ code: "", account: tb.balanced ? "Total (balanced)" : "Total (NOT BALANCED)", type: "", debit: tb.debit, credit: tb.credit }],
      };
    }
    case "profit-loss": {
      const p = await profitAndLoss(from, to);
      return {
        title: REPORT_TITLES[type],
        subtitle: period,
        columns: [{ key: "section", label: "Section" }, { key: "code", label: "Code" }, { key: "account", label: "Account" }, { key: "amount", label: "Amount", money: true }],
        rows: [
          ...p.income.map((a) => ({ section: "Income", code: a.code, account: a.name, amount: a.amount })),
          ...p.expense.map((a) => ({ section: "Expenses", code: a.code, account: a.name, amount: a.amount })),
        ],
        totals: [
          { section: "Total income", code: "", account: "", amount: p.totalIncome },
          { section: "Total expenses", code: "", account: "", amount: p.totalExpense },
          { section: p.netProfit >= 0 ? "Net profit" : "Net loss", code: "", account: "", amount: p.netProfit },
        ],
      };
    }
    case "balance-sheet": {
      const b = await balanceSheet(to);
      return {
        title: REPORT_TITLES[type],
        subtitle: `As of ${to.toISOString().slice(0, 10)}`,
        columns: [{ key: "section", label: "Section" }, { key: "code", label: "Code" }, { key: "account", label: "Account" }, { key: "amount", label: "Amount", money: true }],
        rows: [
          ...b.assets.map((a) => ({ section: "Assets", code: a.code, account: a.name, amount: a.amount })),
          ...b.liabilities.map((a) => ({ section: "Liabilities", code: a.code, account: a.name, amount: a.amount })),
          ...b.equity.map((a) => ({ section: "Equity", code: a.code, account: a.name, amount: a.amount })),
          { section: "Equity", code: "", account: "Current period profit / (loss)", amount: b.profit },
        ],
        totals: [
          { section: "Total assets", code: "", account: "", amount: b.totalAssets },
          { section: "Total liabilities + equity", code: "", account: b.balanced ? "" : "NOT BALANCED", amount: b.totalLiabilities + b.totalEquity },
        ],
      };
    }
    case "gst-summary": {
      const g = await gstSummary(from, to);
      return {
        title: REPORT_TITLES[type],
        subtitle: period,
        columns: [
          { key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "number", label: "Number" }, { key: "party", label: "Party" }, { key: "gstin", label: "GSTIN" }, { key: "pos", label: "POS" },
          { key: "taxable", label: "Taxable", money: true }, { key: "cgst", label: "CGST", money: true }, { key: "sgst", label: "SGST", money: true }, { key: "igst", label: "IGST", money: true }, { key: "total", label: "Total", money: true },
        ],
        rows: g.rows,
        totals: [
          { date: "", type: "Output tax (ledger)", number: "", party: "", gstin: "", pos: "", taxable: null, cgst: g.outward.cgst, sgst: g.outward.sgst, igst: g.outward.igst, total: g.outTotal },
          { date: "", type: "Input tax credit (ledger)", number: "", party: "", gstin: "", pos: "", taxable: null, cgst: g.input.cgst, sgst: g.input.sgst, igst: g.input.igst, total: g.inTotal },
          { date: "", type: "Net GST payable", number: "", party: "", gstin: "", pos: "", taxable: null, cgst: null, sgst: null, igst: null, total: g.netPayable },
        ],
      };
    }
    case "project-costing": {
      const c = await projectCosting(from, to);
      const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
      const margin = (r: { revenue: number; profit: number }) => (r.revenue > 0 ? `${((r.profit * 100) / r.revenue).toFixed(1)}%` : "—");
      const sum = (k: "revenue" | "directCost" | "sharedCost" | "totalCost" | "profit") => c.rows.reduce((s, r) => s + r[k], 0);
      const totalRev = sum("revenue");
      const totalProfit = sum("profit");
      return {
        title: REPORT_TITLES[type],
        subtitle: `${period} · shared costs split by revenue share`,
        columns: [
          { key: "code", label: "Code" }, { key: "name", label: "Project" }, { key: "revenue", label: "Revenue", money: true }, { key: "directCost", label: "Direct cost", money: true },
          { key: "share", label: "Share" }, { key: "sharedCost", label: "Shared cost", money: true }, { key: "totalCost", label: "Total cost", money: true }, { key: "profit", label: "Profit", money: true }, { key: "margin", label: "Margin" },
        ],
        rows: c.rows.map((r) => ({ code: r.code, name: r.name, revenue: r.revenue, directCost: r.directCost, share: pct(r.shareBps), sharedCost: r.sharedCost, totalCost: r.totalCost, profit: r.profit, margin: margin(r) })),
        totals: [
          { code: "", name: "All projects", revenue: totalRev, directCost: sum("directCost"), share: "", sharedCost: sum("sharedCost"), totalCost: sum("totalCost"), profit: totalProfit, margin: margin({ revenue: totalRev, profit: totalProfit }) },
          { code: "", name: "Shared costs in period", revenue: null, directCost: null, share: "", sharedCost: c.sharedCost, totalCost: null, profit: null, margin: c.unallocated ? "not split: no project revenue" : "" },
          { code: "", name: "Income not tagged to a project", revenue: c.untaggedIncome, directCost: null, share: "", sharedCost: null, totalCost: null, profit: null, margin: "" },
        ],
      };
    }
    case "receivables":
    case "payables": {
      const rows = await outstanding(type === "receivables" ? "SALES" : "PURCHASE", to);
      return {
        title: REPORT_TITLES[type],
        subtitle: `As of ${to.toISOString().slice(0, 10)}`,
        columns: [{ key: "number", label: "Invoice" }, { key: "party", label: "Party" }, { key: "date", label: "Date" }, { key: "due", label: "Due" }, { key: "bucket", label: "Age" }, { key: "total", label: "Total", money: true }, { key: "balance", label: "Balance", money: true }],
        rows,
        totals: [{ number: "Total", party: "", date: "", due: "", bucket: "", total: rows.reduce((s, r) => s + r.total, 0), balance: rows.reduce((s, r) => s + r.balance, 0) }],
      };
    }
  }
}
