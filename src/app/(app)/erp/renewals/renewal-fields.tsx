import { CYCLES, RENEWAL_CATEGORIES } from "@/lib/renewals";
import { GST_RATES_BPS } from "@/lib/gst";
import { Field, SelectField, TextareaField } from "@/components/forms";

type Opt = { id: string; code?: string; name: string };

export interface RenewalDefaults {
  name?: string;
  category?: string;
  provider?: string | null;
  reference?: string | null;
  vendorId?: string | null;
  costCentreId?: string | null;
  accountId?: string | null;
  startDate?: string;
  renewalDate?: string;
  cycleMonths?: number;
  amount?: number;
  gstRateBps?: number;
  autoRenew?: boolean;
  remindDays?: number;
  notes?: string | null;
}

/** Fields shared by the "new renewal" and "edit" forms (plain inputs inside a server-action form). */
export function RenewalFields({ d = {}, vendors, projects, accounts }: { d?: RenewalDefaults; vendors: Opt[]; projects: Opt[]; accounts: Opt[] }) {
  return (
    <>
      <Field label="Name" name="name" required defaultValue={d.name} placeholder="metechsolutions.in" className="md:col-span-2" />
      <SelectField label="Type" name="category" defaultValue={d.category ?? "DOMAIN"} options={Object.entries(RENEWAL_CATEGORIES).map(([value, label]) => ({ value, label }))} />
      <Field label="Provider" name="provider" defaultValue={d.provider ?? ""} placeholder="GoDaddy, Hostinger, Azure…" />
      <Field label="Start date" name="startDate" type="date" required defaultValue={d.startDate} />
      <Field label="Renewal (expiry) date" name="renewalDate" type="date" required defaultValue={d.renewalDate} />
      <SelectField label="Renews" name="cycleMonths" defaultValue={String(d.cycleMonths ?? 12)} options={CYCLES.map((c) => ({ value: String(c.months), label: c.label }))} />
      <Field label="Renewal price (₹, before GST)" name="amount" inputMode="decimal" defaultValue={d.amount ? String(d.amount / 100) : ""} />
      <SelectField label="GST" name="gstRateBps" defaultValue={String(d.gstRateBps ?? 1800)} options={GST_RATES_BPS.map((r) => ({ value: String(r), label: `${r / 100}%` }))} />
      <SelectField label="Project" name="costCentreId" defaultValue={d.costCentreId ?? ""} placeholder="Shared (company-wide)" options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
      <SelectField label="Vendor (in contacts)" name="vendorId" defaultValue={d.vendorId ?? ""} placeholder="—" options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
      <SelectField label="Expense account" name="accountId" defaultValue={d.accountId ?? ""} placeholder="Default: Cloud & software" options={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
      <Field label="Account / order ref" name="reference" defaultValue={d.reference ?? ""} />
      <Field label="Remind days before" name="remindDays" type="number" min={0} max={365} defaultValue={String(d.remindDays ?? 30)} />
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="autoRenew" defaultChecked={d.autoRenew ?? false} /> Auto-renews at the provider
      </label>
      <TextareaField label="Notes" name="notes" defaultValue={d.notes ?? ""} className="md:col-span-4" />
    </>
  );
}
