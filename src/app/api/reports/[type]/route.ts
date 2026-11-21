import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { REPORT_TYPES, buildReport, ledger, type ReportType, type Table } from "@/server/accounting/reports";
import { toPdf, toXlsx } from "@/server/export";
import { dateRange } from "@/lib/dates";

/** Excel / PDF export of any report, plus account / party ledgers (type = "ledger"). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  if (!(await getSessionUser())) return NextResponse.json({ error: { message: "Sign in" } }, { status: 401 });
  const { type } = await ctx.params;
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const r = dateRange(sp);
  let table: Table;
  if (type === "ledger") {
    if (!sp.accountId && !sp.partyId) return NextResponse.json({ error: { message: "accountId or partyId required" } }, { status: 400 });
    const [acc, party] = await Promise.all([sp.accountId ? db.account.findUnique({ where: { id: sp.accountId } }) : null, sp.partyId ? db.party.findUnique({ where: { id: sp.partyId } }) : null]);
    const l = await ledger({ accountId: sp.accountId, partyId: sp.partyId, from: r.from, to: r.to });
    table = {
      title: `Ledger — ${[acc?.name, party?.name].filter(Boolean).join(" · ")}`,
      subtitle: `${r.fromIso} to ${r.toIso}`,
      columns: [{ key: "date", label: "Date" }, { key: "number", label: "Entry" }, { key: "narration", label: "Narration" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }, { key: "balance", label: "Balance (Dr+)", money: true }],
      rows: [{ date: r.fromIso, number: "", narration: "Opening balance", debit: null, credit: null, balance: l.openingBalance }, ...l.rows],
      totals: [{ date: "", number: "", narration: "Closing balance", debit: null, credit: null, balance: l.closingBalance }],
    };
  } else if (REPORT_TYPES.includes(type as ReportType)) {
    table = await buildReport(type as ReportType, r.from, r.to);
  } else {
    return NextResponse.json({ error: { message: "Unknown report" } }, { status: 404 });
  }
  const company = (await db.companySettings.findUnique({ where: { id: "company" } }))?.name ?? "Metech Solutions";
  const base = `${type}_${r.fromIso}_${r.toIso}`;
  if (sp.format === "pdf") {
    return new Response(new Uint8Array(await toPdf(table, company)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${base}.pdf"` } });
  }
  return new Response(new Uint8Array(await toXlsx(table, company)), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` },
  });
}
