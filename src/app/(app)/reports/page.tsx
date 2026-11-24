import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { REPORT_TITLES, REPORT_TYPES } from "@/server/accounting/reports";
import { PageHeader } from "@/components/page";

export const metadata = { title: "Reports" };

const DESCRIPTIONS: Record<string, string> = {
  "trial-balance": "Debit and credit balance of every account; must balance.",
  "profit-loss": "Income and expenses for a period, including Dukaan commission and costs.",
  "balance-sheet": "Assets, liabilities and equity as of a date.",
  "gst-summary": "Outward and inward supplies with CGST/SGST/IGST and net GST payable.",
  receivables: "Unpaid sales invoices with ageing.",
  payables: "Unpaid purchase bills with ageing.",
  "project-costing": "Revenue, direct cost, share of shared costs and profit for each project.",
  renewals: "Active domains and subscriptions with renewal dates, time left and yearly cost.",
};

export default async function ReportsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Reports" description="Every report opens on screen and exports to Excel or PDF. Ledgers are under Accounting → Ledger." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_TYPES.map((t) => (
          <Link key={t} href={`/reports/${t}`} className="rounded-xl border bg-card p-4 hover:border-primary/50">
            <div className="font-semibold">{REPORT_TITLES[t]}</div>
            <p className="mt-1 text-sm text-muted-foreground">{DESCRIPTIONS[t]}</p>
          </Link>
        ))}
        <Link href="/reports/gstr1" className="rounded-xl border bg-card p-4 hover:border-primary/50">
          <div className="font-semibold">GSTR-1</div>
          <p className="mt-1 text-sm text-muted-foreground">Monthly outward supplies (B2B, B2C, credit/debit notes, HSN) as a JSON file for the GST portal.</p>
        </Link>
        <Link href="/accounting/ledger" className="rounded-xl border bg-card p-4 hover:border-primary/50">
          <div className="font-semibold">Ledgers</div>
          <p className="mt-1 text-sm text-muted-foreground">Account and party statements with running balance.</p>
        </Link>
      </div>
    </>
  );
}
