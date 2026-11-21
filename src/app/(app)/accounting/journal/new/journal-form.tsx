"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, NativeSelect, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR, parseRupees } from "@/lib/money";
import { saveJournal } from "../../actions";

interface L {
  accountId: string;
  partyId: string;
  costCentreId: string;
  memo: string;
  debit: string;
  credit: string;
}
const blank = (): L => ({ accountId: "", partyId: "", costCentreId: "", memo: "", debit: "", credit: "" });
const p = (s: string) => {
  try {
    return parseRupees(s);
  } catch {
    return 0;
  }
};

export function JournalForm({
  accounts,
  parties,
  centres,
  today,
}: {
  accounts: { id: string; code: string; name: string }[];
  parties: { id: string; name: string }[];
  centres: { id: string; code: string; name: string }[];
  today: string;
}) {
  const [date, setDate] = useState(today);
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<L[]>([blank(), blank()]);
  const set = (i: number, patch: Partial<L>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const dr = lines.reduce((s, l) => s + p(l.debit), 0);
  const cr = lines.reduce((s, l) => s + p(l.credit), 0);
  const payload = JSON.stringify({
    date,
    narration,
    lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, partyId: l.partyId || null, costCentreId: l.costCentreId || null, memo: l.memo || null, debit: p(l.debit), credit: p(l.credit) })),
  });
  return (
    <ActionForm action={saveJournal} resetOnSuccess={false} className="grid gap-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[180px_1fr_auto]">
        <Field label="Date" name="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Field label="Narration" name="n" value={narration} onChange={(e) => setNarration(e.target.value)} required />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="opening" value="1" /> Opening balance
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Account</th>
              <th className="p-2">Party</th>
              <th className="p-2">Cost centre</th>
              <th className="p-2">Memo</th>
              <th className="p-2 w-32">Debit (₹)</th>
              <th className="p-2 w-32">Credit (₹)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="p-1.5">
                  <NativeSelect value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
                    <option value="">Choose account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-1.5">
                  <NativeSelect value={l.partyId} onChange={(e) => set(i, { partyId: e.target.value })}>
                    <option value="">—</option>
                    {parties.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-1.5">
                  <NativeSelect value={l.costCentreId} onChange={(e) => set(i, { costCentreId: e.target.value })}>
                    <option value="">—</option>
                    {centres.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td className="p-1.5">
                  <Input value={l.memo} onChange={(e) => set(i, { memo: e.target.value })} />
                </td>
                <td className="p-1.5">
                  <Input value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} inputMode="decimal" />
                </td>
                <td className="p-1.5">
                  <Input value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} inputMode="decimal" />
                </td>
                <td className="p-1.5">
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((_, j) => j !== i) : ls))} aria-label="Remove line">
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="border-t bg-muted/40 font-semibold">
              <td className="p-2" colSpan={4}>
                {dr === cr ? (dr ? "Balanced" : "") : `Difference ${formatINR(Math.abs(dr - cr))}`}
              </td>
              <td className="p-2 tabular-nums">{formatINR(dr)}</td>
              <td className="p-2 tabular-nums">{formatINR(cr)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="border-t p-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Plus /> Add line
          </Button>
        </div>
      </div>
      <div>
        <SubmitButton>Post entry</SubmitButton>
      </div>
    </ActionForm>
  );
}
