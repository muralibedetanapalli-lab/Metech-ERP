import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { REPORT_TITLES, REPORT_TYPES, buildReport, type ReportType } from "@/server/accounting/reports";
import { dateRange } from "@/lib/dates";
import { PageHeader, ReportView } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return { title: REPORT_TITLES[type as ReportType] ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { type } = await params;
  const sp = await searchParams;
  await requireUser();
  if (!REPORT_TYPES.includes(type as ReportType)) notFound();
  const r = dateRange(sp);
  const table = await buildReport(type as ReportType, r.from, r.to);
  const qs = `from=${r.fromIso}&to=${r.toIso}`;
  const asOf = type === "trial-balance" || type === "balance-sheet" || type === "receivables" || type === "payables" || type === "renewals";
  return (
    <>
      <PageHeader
        title={REPORT_TITLES[type as ReportType]}
        description={table.subtitle}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/reports/${type}?${qs}&format=xlsx`}>Excel</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/reports/${type}?${qs}&format=pdf`} target="_blank">
                PDF
              </a>
            </Button>
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {!asOf && (
          <>
            <span className="text-muted-foreground">From</span>
            <Input type="date" name="from" defaultValue={r.fromIso} className="w-40" />
          </>
        )}
        <span className="text-muted-foreground">{asOf ? "As of" : "To"}</span>
        <Input type="date" name="to" defaultValue={r.toIso} className="w-40" />
        <Button type="submit" variant="outline">
          Update
        </Button>
      </form>
      <ReportView table={table} />
    </>
  );
}
