import { centreOptions } from "@/lib/cost-centres";
import { GST_RATES_BPS } from "@/lib/gst";
import { Field, SelectField } from "@/components/forms";

type Opt = { id: string; code?: string; name: string; type?: string; kind?: string };

export type ExpenseDefaults = Partial<{
  date: string;
  accountId: string;
  paidFromId: string;
  amount: number;
  gstRateBps: number;
  partyId: string | null;
  costCentreId: string | null;
  reference: string | null;
  description: string;
  interState: boolean;
}>;

/** Fields shared by the "record an expense" and "edit expense" forms. */
export function ExpenseFields({ d = {}, accounts, banks, parties, centres }: { d?: ExpenseDefaults; accounts: Opt[]; banks: Opt[]; parties: Opt[]; centres: Opt[] }) {
  return (
    <>
      <Field label="Date" name="date" type="date" defaultValue={d.date} required />
      <SelectField label="Expense account" name="accountId" defaultValue={d.accountId} options={accounts.filter((a) => a.type === "EXPENSE").map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
      <SelectField label="Paid from" name="paidFromId" defaultValue={d.paidFromId} options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
      <Field label="Amount before GST (₹)" name="amount" inputMode="decimal" required defaultValue={d.amount ? String(d.amount / 100) : ""} />
      <SelectField label="GST" name="gstRateBps" defaultValue={String(d.gstRateBps ?? 0)} options={GST_RATES_BPS.map((r) => ({ value: String(r), label: `${r / 100}%` }))} />
      <SelectField label="Vendor" name="partyId" defaultValue={d.partyId ?? ""} placeholder="—" options={parties.map((p) => ({ value: p.id, label: p.name }))} />
      <SelectField label="Project / cost centre" name="costCentreId" defaultValue={d.costCentreId ?? ""} placeholder="—" options={centreOptions(centres)} />
      <Field label="Reference" name="reference" defaultValue={d.reference ?? ""} />
      <Field label="Description" name="description" required className="md:col-span-3" defaultValue={d.description} />
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="interState" defaultChecked={d.interState ?? false} /> Inter-state (IGST)
      </label>
    </>
  );
}
