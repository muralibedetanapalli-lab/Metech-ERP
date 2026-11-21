"use client";

import { useState } from "react";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { formatINR, parseRupees } from "@/lib/money";
import { savePayment } from "../actions";

interface OpenInvoice {
  id: string;
  number: string;
  kind: "SALES" | "PURCHASE";
  partyId: string;
  balance: number;
}

export function PaymentForm({
  parties,
  banks,
  accounts,
  openInvoices,
  today,
  defaults,
}: {
  parties: { id: string; name: string }[];
  banks: { id: string; code: string; name: string }[];
  accounts: { id: string; code: string; name: string }[];
  openInvoices: OpenInvoice[];
  today: string;
  defaults: { kind?: string; partyId?: string; invoiceId?: string };
}) {
  const [kind, setKind] = useState(defaults.kind === "PAYMENT" ? "PAYMENT" : "RECEIPT");
  const [partyId, setPartyId] = useState(defaults.partyId ?? "");
  const invoices = openInvoices.filter((i) => i.partyId === partyId && i.kind === (kind === "RECEIPT" ? "SALES" : "PURCHASE"));
  const [alloc, setAlloc] = useState<Record<string, string>>(() => {
    const inv = openInvoices.find((i) => i.id === defaults.invoiceId);
    return inv ? { [inv.id]: String(inv.balance / 100) } : {};
  });
  const [amount, setAmount] = useState(() => {
    const inv = openInvoices.find((i) => i.id === defaults.invoiceId);
    return inv ? String(inv.balance / 100) : "";
  });
  const toPaise = (s: string) => {
    try {
      return parseRupees(s);
    } catch {
      return 0;
    }
  };
  const allocations = invoices.map((i) => ({ invoiceId: i.id, amount: toPaise(alloc[i.id] ?? "") })).filter((a) => a.amount > 0);
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);

  return (
    <ActionForm action={savePayment} className="grid gap-3" onSuccess={() => (setAlloc({}), setAmount(""))}>
      <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField label="Type" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "RECEIPT", label: "Receipt (money in)" }, { value: "PAYMENT", label: "Payment (money out)" }]} />
        <Field label="Date" name="date" type="date" defaultValue={today} required />
        <Field label="Amount (₹)" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <SelectField label="Party" name="partyId" value={partyId} onChange={(e) => setPartyId(e.target.value)} placeholder="— none (use counter account) —" options={parties.map((p) => ({ value: p.id, label: p.name }))} />
        <SelectField label={kind === "RECEIPT" ? "Deposited to" : "Paid from"} name="bankAccountId" options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
        <SelectField label="Mode" name="mode" options={["BANK", "UPI", "CASH", "CHEQUE", "CARD"].map((m) => ({ value: m, label: m }))} />
        <Field label="Reference / UTR" name="reference" />
        <SelectField
          label="Counter account (optional)"
          name="counterAccountId"
          placeholder={kind === "RECEIPT" ? "Default: party receivable" : "Default: party payable"}
          options={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
          className="md:col-span-2"
        />
      </div>
      {invoices.length > 0 && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 text-sm font-medium">Settle invoices</div>
          <div className="grid gap-2">
            {invoices.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {i.number} · due {formatINR(i.balance)}
                </span>
                <Input className="w-32" inputMode="decimal" placeholder="0" value={alloc[i.id] ?? ""} onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Allocated {formatINR(allocated)} of {formatINR(toPaise(amount))}. Any rest stays on the party as an advance.
          </div>
        </div>
      )}
      <div>
        <SubmitButton>Record {kind === "RECEIPT" ? "receipt" : "payment"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
