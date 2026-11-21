"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, NativeSelect, SelectField, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GST_RATES_BPS, GST_STATES, computeInvoiceTotals } from "@/lib/gst";
import { formatINR, parseRupees } from "@/lib/money";
import { docLabel, type DocType } from "@/lib/doc-types";
import { saveInvoice } from "../../actions";

interface Line {
  itemId: string;
  description: string;
  hsnSac: string;
  quantity: string;
  rate: string; // rupees as typed
  discount: string;
  taxRateBps: number;
  accountId: string;
}

/** An invoice a credit / debit note can refer to, with its lines for copying. */
export interface SourceInvoice {
  id: string;
  number: string;
  partyId: string;
  date: string;
  placeOfSupply: string;
  total: number;
  lines: { itemId: string | null; description: string; hsnSac: string | null; quantity: number; rate: number; discount: number; taxRateBps: number; accountId: string }[];
}

const blank = (): Line => ({ itemId: "", description: "", hsnSac: "", quantity: "1", rate: "", discount: "", taxRateBps: 1800, accountId: "" });
const fromSource = (s: SourceInvoice): Line[] =>
  s.lines.map((l) => ({
    itemId: l.itemId ?? "",
    description: l.description,
    hsnSac: l.hsnSac ?? "",
    quantity: String(l.quantity),
    rate: String(l.rate / 100),
    discount: l.discount ? String(l.discount / 100) : "",
    taxRateBps: l.taxRateBps,
    accountId: l.accountId,
  }));
const safeRupees = (s: string) => {
  try {
    return parseRupees(s);
  } catch {
    return 0;
  }
};

export function InvoiceForm({
  kind,
  parties,
  accounts,
  items,
  costCentres,
  companyState,
  today,
  defaultPartyId,
  docType = "INVOICE",
  sourceInvoices = [],
  defaultSourceId,
}: {
  kind: "SALES" | "PURCHASE";
  docType?: DocType;
  sourceInvoices?: SourceInvoice[];
  defaultSourceId?: string;
  parties: { id: string; name: string; stateCode: string | null; gstin: string | null }[];
  accounts: { id: string; code: string; name: string }[];
  items: { id: string; sku: string; name: string; hsnSac: string | null; salePrice: number; purchasePrice: number; taxRateBps: number }[];
  costCentres: { id: string; code: string; name: string }[];
  companyState: string;
  today: string;
  defaultPartyId?: string;
}) {
  const [partyId, setPartyId] = useState(defaultPartyId ?? "");
  const party = parties.find((p) => p.id === partyId);
  const initialSource = sourceInvoices.find((s) => s.id === defaultSourceId);
  const [sourceId, setSourceId] = useState(initialSource?.id ?? "");
  const [pos, setPos] = useState(initialSource?.placeOfSupply ?? party?.stateCode ?? companyState);
  const [lines, setLines] = useState<Line[]>(initialSource ? fromSource(initialSource) : [blank()]);
  const sales = kind === "SALES";
  const note = docType !== "INVOICE";
  const partySources = sourceInvoices.filter((s) => s.partyId === partyId);
  const pickSource = (id: string) => {
    setSourceId(id);
    const s = sourceInvoices.find((x) => x.id === id);
    if (s) {
      setPos(s.placeOfSupply);
      setLines(fromSource(s));
    }
  };
  // Sales: supplier = us, place of supply = customer state. Purchases: supplier = vendor, place of supply = us.
  const supplierState = sales ? companyState : (party?.stateCode ?? companyState);
  const placeOfSupply = sales ? pos : companyState;

  const parsed = lines.map((l) => ({ quantity: Number(l.quantity) || 0, rate: safeRupees(l.rate), discount: safeRupees(l.discount), taxRateBps: l.taxRateBps }));
  const totals = computeInvoiceTotals(parsed, supplierState, placeOfSupply);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    set(i, it ? { itemId, description: it.name, hsnSac: it.hsnSac ?? "", rate: String((sales ? it.salePrice : it.purchasePrice) / 100), taxRateBps: it.taxRateBps } : { itemId: "" });
  };

  const payload = JSON.stringify({
    kind,
    docType,
    originalInvoiceId: note && sourceId ? sourceId : null,
    partyId,
    placeOfSupply,
    lines: lines
      .filter((l) => l.description.trim())
      .map((l) => ({ itemId: l.itemId || null, description: l.description, hsnSac: l.hsnSac || null, quantity: Number(l.quantity) || 0, rate: safeRupees(l.rate), discount: safeRupees(l.discount), taxRateBps: l.taxRateBps, accountId: l.accountId || null })),
  });

  return (
    <ActionForm action={saveInvoice} resetOnSuccess={false} className="grid gap-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-4">
        <SelectField
          label={sales ? "Customer" : "Vendor"}
          name="partyId"
          value={partyId}
          onChange={(e) => {
            setPartyId(e.target.value);
            setSourceId("");
            const p = parties.find((x) => x.id === e.target.value);
            if (p?.stateCode) setPos(p.stateCode);
          }}
          placeholder="Choose…"
          options={parties.map((p) => ({ value: p.id, label: p.gstin ? `${p.name} (${p.gstin})` : p.name }))}
          className="md:col-span-2"
          required
        />
        <DateInputs today={today} note={note} />
        {note && (
          <>
            <SelectField
              label={`Against ${sales ? "invoice" : "bill"} (optional)`}
              name="originalInvoiceId"
              value={sourceId}
              onChange={(e) => pickSource(e.target.value)}
              placeholder={partyId ? (partySources.length ? "Choose… (copies its lines)" : "No invoices for this party") : "Choose the party first"}
              options={partySources.map((s) => ({ value: s.id, label: `${s.number} · ${s.date} · ${formatINR(s.total)}` }))}
              className="md:col-span-2"
            />
            <Field label="Reason" name="noteReason" placeholder={docType === "CREDIT_NOTE" ? "e.g. goods returned, discount" : "e.g. rate difference, extra charges"} required className="md:col-span-2" />
          </>
        )}
        {sales ? (
          <SelectField label="Place of supply" name="pos" value={pos} onChange={(e) => setPos(e.target.value)} options={Object.entries(GST_STATES).sort(([a], [b]) => a.localeCompare(b)).map(([v, l]) => ({ value: v, label: `${v} · ${l}` }))} />
        ) : (
          <Field label={note ? "Vendor's note no." : "Supplier bill no."} name="vendorRef" />
        )}
        <SelectField label="Project / cost centre" name="costCentreId" placeholder="—" options={costCentres.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
        <div className="text-xs text-muted-foreground md:col-span-2 md:self-end">
          {totals.interState ? "Inter-state supply: IGST applies." : "Intra-state supply: CGST + SGST apply."}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Item</th>
              <th className="p-2">Description</th>
              <th className="p-2">HSN/SAC</th>
              <th className="p-2 w-20">Qty</th>
              <th className="p-2 w-28">Rate (₹)</th>
              <th className="p-2 w-24">Disc. (₹)</th>
              <th className="p-2 w-24">GST</th>
              <th className="p-2">Account</th>
              <th className="p-2 text-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t align-top">
                <td className="p-1.5">
                  <NativeSelect value={l.itemId} onChange={(e) => pickItem(i, e.target.value)} className="w-36">
                    <option value="">—</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-1.5">
                  <Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Description" />
                </td>
                <td className="p-1.5">
                  <Input value={l.hsnSac} onChange={(e) => set(i, { hsnSac: e.target.value })} className="w-24" />
                </td>
                <td className="p-1.5">
                  <Input value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" />
                </td>
                <td className="p-1.5">
                  <Input value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} inputMode="decimal" />
                </td>
                <td className="p-1.5">
                  <Input value={l.discount} onChange={(e) => set(i, { discount: e.target.value })} inputMode="decimal" />
                </td>
                <td className="p-1.5">
                  <NativeSelect value={l.taxRateBps} onChange={(e) => set(i, { taxRateBps: Number(e.target.value) })}>
                    {GST_RATES_BPS.map((r) => (
                      <option key={r} value={r}>
                        {r / 100}%
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-1.5">
                  <NativeSelect value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })} className="w-44">
                    <option value="">Default ({sales ? "Sales" : "Purchases"})</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-2 text-right tabular-nums">{formatINR(totals.lines[i]?.amount ?? 0)}</td>
                <td className="p-1.5">
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} aria-label="Remove line">
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t p-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Plus /> Add line
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid w-full max-w-md gap-1.5">
          <Label htmlFor="notes">Notes / terms</Label>
          <textarea id="notes" name="notesText" className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
        </div>
        <dl className="grid min-w-64 grid-cols-2 gap-x-6 gap-y-1 rounded-xl border bg-card p-4 text-sm">
          <dt className="text-muted-foreground">Taxable</dt>
          <dd className="text-right tabular-nums">{formatINR(totals.taxableAmount)}</dd>
          {totals.interState ? (
            <>
              <dt className="text-muted-foreground">IGST</dt>
              <dd className="text-right tabular-nums">{formatINR(totals.igst)}</dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">CGST</dt>
              <dd className="text-right tabular-nums">{formatINR(totals.cgst)}</dd>
              <dt className="text-muted-foreground">SGST</dt>
              <dd className="text-right tabular-nums">{formatINR(totals.sgst)}</dd>
            </>
          )}
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{formatINR(totals.total)}</dd>
        </dl>
      </div>
      <div>
        <SubmitButton>Post {note ? docLabel(kind, docType, true).toLowerCase() : sales ? "invoice" : "bill"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function DateInputs({ today, note }: { today: string; note: boolean }) {
  return (
    <>
      <Field label="Date" name="date" type="date" defaultValue={today} required />
      {note ? <span className="hidden md:block" /> : <Field label="Due date" name="dueDate" type="date" />}
    </>
  );
}
