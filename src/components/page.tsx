import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatAmount, formatINR } from "@/lib/money";
import type { Table as ReportTable } from "@/server/accounting/reports";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "good" | "bad" }) {
  const body = (
    <div className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "good" && "text-success", tone === "bad" && "text-destructive")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Money({ value, className, compact }: { value: number | null | undefined; className?: string; compact?: boolean }) {
  return <span className={cn("tabular-nums", (value ?? 0) < 0 && "text-destructive", className)}>{formatINR(value, { compact })}</span>;
}

export function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    default: "bg-muted text-muted-foreground",
    green: "bg-success/15 text-success",
    amber: "bg-warning/20 text-amber-700",
    red: "bg-destructive/10 text-destructive",
    blue: "bg-info/15 text-info",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Simple responsive table. */
export function T({ head, children, className }: { head: React.ReactNode[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border bg-card", className)}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2 align-top";
export const tdNum = "px-3 py-2 text-right tabular-nums whitespace-nowrap align-top";

/** Render a report Table (same structure as the Excel/PDF export). */
export function ReportView({ table, links }: { table: ReportTable; links?: (row: Record<string, unknown>) => string | null }) {
  return (
    <T head={table.columns.map((c) => <span key={c.key} className={c.money ? "block text-right" : ""}>{c.label}</span>)}>
      {table.rows.length === 0 && (
        <tr>
          <td colSpan={table.columns.length} className="p-6 text-center text-muted-foreground">
            No data for this period.
          </td>
        </tr>
      )}
      {table.rows.map((r, i) => {
        const href = links?.(r);
        return (
          <tr key={i} className="hover:bg-muted/30">
            {table.columns.map((c, j) => (
              <td key={c.key} className={c.money ? tdNum : td}>
                {c.money ? (r[c.key] === null ? "" : formatAmount(r[c.key] as number)) : j === 0 && href ? <Link className="text-primary hover:underline" href={href}>{String(r[c.key] ?? "")}</Link> : String(r[c.key] ?? "")}
              </td>
            ))}
          </tr>
        );
      })}
      {table.totals?.map((r, i) => (
        <tr key={`t${i}`} className="bg-muted/40 font-semibold">
          {table.columns.map((c) => (
            <td key={c.key} className={c.money ? tdNum : td}>
              {c.money ? (r[c.key] === null || r[c.key] === undefined ? "" : formatAmount(r[c.key] as number)) : String(r[c.key] ?? "")}
            </td>
          ))}
        </tr>
      ))}
    </T>
  );
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";

export const isoDate = (d: Date = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export const statusTone = (s: string) => (s === "PAID" ? "green" : s === "VOID" ? "red" : s === "PARTIAL" ? "blue" : "amber") as "green" | "red" | "blue" | "amber";
