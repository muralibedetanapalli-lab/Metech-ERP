import { FileDown } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { gstr1ForMonth } from "@/server/accounting/gstr1";
import { todayIso } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, T, td, tdNum } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "GSTR-1" };

/** Default to last month: GSTR-1 is filed by the 11th of the next month. */
function lastMonth() {
  const [y, m] = todayIso().split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export default async function Gstr1Page({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : lastMonth();
  const g = await gstr1ForMonth(month);
  return (
    <>
      <PageHeader
        title="GSTR-1"
        description="Outward supplies for the month from sales invoices, credit notes and debit notes, as a JSON file in the GST portal's GSTR-1 format."
        actions={
          <Button asChild>
            <a href={`/api/gstr1?month=${month}`}>
              <FileDown /> Download JSON
            </a>
          </Button>
        }
      />
      <form className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Return period</span>
        <Input type="month" name="month" defaultValue={month} className="w-44" />
        <Button type="submit" variant="outline">
          Update
        </Button>
      </form>
      <div className="grid gap-4">
        {g.warnings.length > 0 && (
          <Panel title="Check before filing">
            <ul className="grid list-disc gap-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
              {g.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Panel>
        )}
        <Panel title="Sections">
          {g.sections.length === 0 ? (
            <Empty>No sales invoices or notes in this month.</Empty>
          ) : (
            <T head={["Section", <span key="c" className="block text-right">Documents</span>, <span key="t" className="block text-right">Taxable value</span>, <span key="x" className="block text-right">Tax</span>]}>
              {g.sections.map((s) => (
                <tr key={s.key}>
                  <td className={td}>{s.label}</td>
                  <td className={tdNum}>{s.count}</td>
                  <td className={tdNum}>
                    <Money value={s.taxable} />
                  </td>
                  <td className={tdNum}>
                    <Money value={s.tax} />
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total output tax in documents</td>
                <td className={tdNum} />
                <td className={tdNum}>
                  <Money value={g.sections.reduce((s, x) => s + x.taxable, 0)} />
                </td>
                <td className={tdNum}>
                  <Money value={g.docTax} />
                </td>
              </tr>
              <tr>
                <td className={td}>Output tax per ledger</td>
                <td className={tdNum} />
                <td className={tdNum} />
                <td className={tdNum}>
                  <Money value={g.ledgerTax} />
                </td>
              </tr>
            </T>
          )}
        </Panel>
        <p className="text-xs text-muted-foreground">
          Upload on the GST portal under Returns → GSTR-1 → Prepare offline → Upload, then review each table before you submit. Cancelled (void) documents are excluded from the tables and counted in “Documents issued”.
        </p>
      </div>
    </>
  );
}
