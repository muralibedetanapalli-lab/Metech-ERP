/**
 * Pure GSTR-1 builder (no database), so it can be unit-tested.
 *
 * Sections produced, following the GSTN GSTR-1 JSON layout (amounts in rupees, rates in %):
 *  - b2b    invoices to registered customers (valid GSTIN)
 *  - b2cl   inter-state invoices to unregistered customers above ₹1,00,000
 *  - b2cs   all other unregistered supplies, summed by place of supply and rate (net of their notes)
 *  - cdnr   credit / debit notes to registered customers
 *  - cdnur  credit / debit notes to unregistered customers on large inter-state (B2CL) invoices
 *  - hsn    HSN/SAC summary, split into B2B and B2C
 *  - doc_issue  number ranges issued per series, with cancelled counts
 */

export type DocType = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";

export interface Gstr1Line {
  description: string;
  hsnSac: string | null;
  unit: string | null;
  service: boolean;
  quantity: number;
  taxRateBps: number;
  taxable: number; // paise
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1Doc {
  id: string;
  number: string;
  docType: DocType;
  date: string; // YYYY-MM-DD
  void: boolean;
  partyName: string;
  /** Valid GSTIN, or null for unregistered customers. */
  gstin: string | null;
  /** What was entered, to warn about invalid GSTINs. */
  rawGstin: string | null;
  placeOfSupply: string;
  total: number;
  /** Credit / debit notes: total of the invoice they adjust, when linked. */
  originalTotal: number | null;
  lines: Gstr1Line[];
}

/** Above this, an inter-state supply to an unregistered person is "B2C large" (₹1,00,000 since August 2024). */
export const B2CL_LIMIT = 1_00_000_00;

const r2 = (paise: number) => Math.round(paise) / 100;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const rate = (bps: number) => bps / 100;

const UQC: Record<string, string> = {
  nos: "NOS", no: "NOS", number: "NOS", numbers: "NOS", unit: "UNT", units: "UNT", pcs: "PCS", pc: "PCS", piece: "PCS", pieces: "PCS",
  kg: "KGS", kgs: "KGS", g: "GMS", gm: "GMS", gms: "GMS", gram: "GMS", grams: "GMS", l: "LTR", ltr: "LTR", litre: "LTR", liter: "LTR",
  ml: "MLT", m: "MTR", mtr: "MTR", metre: "MTR", meter: "MTR", box: "BOX", boxes: "BOX", set: "SET", sets: "SET", pack: "PAC", pkt: "PAC",
  packet: "PAC", dozen: "DOZ", doz: "DOZ", pair: "PRS", pairs: "PRS", bag: "BAG", bags: "BAG", bottle: "BTL", bottles: "BTL", ton: "TON", tonne: "TON",
};
const uqcFor = (l: Gstr1Line) => (l.service ? "NA" : (UQC[(l.unit ?? "nos").trim().toLowerCase()] ?? "OTH"));

interface ItemDet {
  txval: number;
  rt: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

/** Group a document's lines by rate (paise), then convert to GSTN item rows. */
function itemsByRate(lines: Gstr1Line[]) {
  const by = new Map<number, { taxable: number; igst: number; cgst: number; sgst: number }>();
  for (const l of lines) {
    const g = by.get(l.taxRateBps) ?? { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    g.taxable += l.taxable;
    g.igst += l.igst;
    g.cgst += l.cgst;
    g.sgst += l.sgst;
    by.set(l.taxRateBps, g);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bps, g], i) => ({ num: i + 1, itm_det: { txval: r2(g.taxable), rt: rate(bps), iamt: r2(g.igst), camt: r2(g.cgst), samt: r2(g.sgst), csamt: 0 } satisfies ItemDet }));
}

export interface Gstr1Section {
  key: string;
  label: string;
  count: number;
  taxable: number; // paise, notes netted (credit notes negative)
  tax: number;
}

export interface Gstr1Result {
  json: Record<string, unknown>;
  sections: Gstr1Section[];
  warnings: string[];
  /** Output tax in the documents (credit notes netted), paise. */
  docTax: number;
  /** Output tax per the ledger for the month, paise. */
  ledgerTax: number;
}

export function buildGstr1(input: { gstin: string | null; companyState: string; month: string; docs: Gstr1Doc[]; ledgerOutputTax: number }): Gstr1Result {
  const warnings: string[] = [];
  const [y, m] = input.month.split("-");
  if (!input.gstin) warnings.push("Company GSTIN is not set (Settings → Company profile). The file needs it before upload.");

  const live = input.docs.filter((d) => !d.void);
  const sign = (d: Gstr1Doc) => (d.docType === "CREDIT_NOTE" ? -1 : 1);
  const tax = (d: Gstr1Doc) => d.lines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0);
  const taxable = (d: Gstr1Doc) => d.lines.reduce((s, l) => s + l.taxable, 0);
  const inter = (d: Gstr1Doc) => d.placeOfSupply !== input.companyState;

  for (const d of live) {
    if (d.rawGstin && !d.gstin) warnings.push(`${d.number}: GSTIN "${d.rawGstin}" of ${d.partyName} is not valid, so it is reported as an unregistered (B2C) supply.`);
    const noHsn = d.lines.filter((l) => !l.hsnSac);
    if (noHsn.length) warnings.push(`${d.number}: ${noHsn.length} line(s) without HSN/SAC; they are grouped under a blank code in the HSN summary.`);
  }

  const isB2cl = (d: Gstr1Doc, value: number) => !d.gstin && inter(d) && value > B2CL_LIMIT;

  // ── b2b / b2cl / cdnr / cdnur / b2cs ──
  const b2b = new Map<string, unknown[]>();
  const b2cl = new Map<string, unknown[]>();
  const cdnr = new Map<string, unknown[]>();
  const cdnur: unknown[] = [];
  const b2cs = new Map<string, { sply_ty: string; pos: string; rt: number; taxable: number; iamt: number; camt: number; samt: number }>();
  const sec = new Map<string, Gstr1Section>();
  const addSec = (key: string, label: string, d: Gstr1Doc) => {
    const s = sec.get(key) ?? { key, label, count: 0, taxable: 0, tax: 0 };
    s.count += 1;
    s.taxable += sign(d) * taxable(d);
    s.tax += sign(d) * tax(d);
    sec.set(key, s);
  };

  for (const d of live) {
    const pos = d.placeOfSupply;
    if (d.docType === "INVOICE") {
      if (d.gstin) {
        const list = b2b.get(d.gstin) ?? [];
        list.push({ inum: d.number, idt: ddmmyyyy(d.date), val: r2(d.total), pos, rchrg: "N", inv_typ: "R", itms: itemsByRate(d.lines) });
        b2b.set(d.gstin, list);
        addSec("b2b", "B2B invoices (4A)", d);
        continue;
      }
      if (isB2cl(d, d.total)) {
        const list = b2cl.get(pos) ?? [];
        list.push({ inum: d.number, idt: ddmmyyyy(d.date), val: r2(d.total), itms: itemsByRate(d.lines).map((it) => ({ num: it.num, itm_det: { txval: it.itm_det.txval, rt: it.itm_det.rt, iamt: it.itm_det.iamt, csamt: 0 } })) });
        b2cl.set(pos, list);
        addSec("b2cl", "B2C large invoices (5)", d);
        continue;
      }
    } else {
      const ntty = d.docType === "CREDIT_NOTE" ? "C" : "D";
      if (d.gstin) {
        const list = cdnr.get(d.gstin) ?? [];
        list.push({ ntty, nt_num: d.number, nt_dt: ddmmyyyy(d.date), val: r2(d.total), pos, rchrg: "N", inv_typ: "R", itms: itemsByRate(d.lines) });
        cdnr.set(d.gstin, list);
        addSec("cdnr", "Credit / debit notes, registered (9B)", d);
        continue;
      }
      if (isB2cl(d, d.originalTotal ?? d.total)) {
        cdnur.push({ typ: "B2CL", ntty, nt_num: d.number, nt_dt: ddmmyyyy(d.date), val: r2(d.total), pos, itms: itemsByRate(d.lines).map((it) => ({ num: it.num, itm_det: { txval: it.itm_det.txval, rt: it.itm_det.rt, iamt: it.itm_det.iamt, csamt: 0 } })) });
        addSec("cdnur", "Credit / debit notes, unregistered (9B)", d);
        continue;
      }
    }
    // Everything else is B2C small: summed per place of supply and rate, notes netted in.
    const sply_ty = inter(d) ? "INTER" : "INTRA";
    for (const l of d.lines) {
      const k = `${sply_ty}|${pos}|${l.taxRateBps}`;
      const g = b2cs.get(k) ?? { sply_ty, pos, rt: rate(l.taxRateBps), taxable: 0, iamt: 0, camt: 0, samt: 0 };
      g.taxable += sign(d) * l.taxable;
      g.iamt += sign(d) * l.igst;
      g.camt += sign(d) * l.cgst;
      g.samt += sign(d) * l.sgst;
      b2cs.set(k, g);
    }
    addSec("b2cs", "B2C small, net of notes (7)", d);
  }
  for (const g of b2cs.values()) if (g.taxable < 0) warnings.push(`B2C ${g.sply_ty.toLowerCase()}-state supplies to state ${g.pos} at ${g.rt}% are negative after credit notes; the portal will not accept a negative B2CS row, so adjust it there.`);

  // ── HSN summary (Table 12), split B2B / B2C ──
  const hsnMaps = { b2b: new Map<string, { hsn_sc: string; desc: string; uqc: string; rt: number; qty: number; taxable: number; iamt: number; camt: number; samt: number }>(), b2c: new Map<string, { hsn_sc: string; desc: string; uqc: string; rt: number; qty: number; taxable: number; iamt: number; camt: number; samt: number }>() };
  for (const d of live) {
    const map = d.gstin ? hsnMaps.b2b : hsnMaps.b2c;
    for (const l of d.lines) {
      const hsn = (l.hsnSac ?? "").trim();
      const uqc = uqcFor(l);
      const k = `${hsn}|${uqc}|${l.taxRateBps}`;
      const g = map.get(k) ?? { hsn_sc: hsn, desc: l.description.slice(0, 30), uqc, rt: rate(l.taxRateBps), qty: 0, taxable: 0, iamt: 0, camt: 0, samt: 0 };
      g.qty += uqc === "NA" ? 0 : sign(d) * l.quantity;
      g.taxable += sign(d) * l.taxable;
      g.iamt += sign(d) * l.igst;
      g.camt += sign(d) * l.cgst;
      g.samt += sign(d) * l.sgst;
      map.set(k, g);
    }
  }
  const hsnRows = (map: (typeof hsnMaps)["b2b"]) =>
    [...map.values()].map((g, i) => ({ num: i + 1, hsn_sc: g.hsn_sc, desc: g.desc, uqc: g.uqc, qty: Math.round(g.qty * 1000) / 1000, rt: g.rt, txval: r2(g.taxable), iamt: r2(g.iamt), camt: r2(g.camt), samt: r2(g.samt), csamt: 0 }));

  // ── Documents issued (Table 13): number ranges per series, including cancelled ones ──
  const docNum: Record<DocType, number> = { INVOICE: 1, DEBIT_NOTE: 4, CREDIT_NOTE: 5 };
  const docDet = (["INVOICE", "DEBIT_NOTE", "CREDIT_NOTE"] as DocType[])
    .map((t) => {
      const all = input.docs.filter((d) => d.docType === t).sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true }));
      if (!all.length) return null;
      const cancel = all.filter((d) => d.void).length;
      return { doc_num: docNum[t], docs: [{ num: 1, from: all[0].number, to: all[all.length - 1].number, totnum: all.length, cancel, net_issue: all.length - cancel }] };
    })
    .filter(Boolean);

  const json: Record<string, unknown> = { gstin: input.gstin ?? "", fp: `${m}${y}` };
  if (b2b.size) json.b2b = [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv }));
  if (b2cl.size) json.b2cl = [...b2cl.entries()].map(([pos, inv]) => ({ pos, inv }));
  if (b2cs.size)
    json.b2cs = [...b2cs.values()].map((g) => ({
      sply_ty: g.sply_ty,
      pos: g.pos,
      typ: "OE",
      rt: g.rt,
      txval: r2(g.taxable),
      ...(g.sply_ty === "INTER" ? { iamt: r2(g.iamt) } : { camt: r2(g.camt), samt: r2(g.samt) }),
      csamt: 0,
    }));
  if (cdnr.size) json.cdnr = [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt }));
  if (cdnur.length) json.cdnur = cdnur;
  if (hsnMaps.b2b.size || hsnMaps.b2c.size) json.hsn = { hsn_b2b: hsnRows(hsnMaps.b2b), hsn_b2c: hsnRows(hsnMaps.b2c) };
  if (docDet.length) json.doc_issue = { doc_det: docDet };

  const docTax = live.reduce((s, d) => s + sign(d) * tax(d), 0);
  if (docTax !== input.ledgerOutputTax)
    warnings.push(
      `Output tax in the ledger (₹${r2(input.ledgerOutputTax).toFixed(2)}) differs from these invoices and notes (₹${r2(docTax).toFixed(2)}). The difference comes from journal entries that are not invoices, such as GST on Dukaan commission or manual journals; report those supplies separately.`,
    );

  return { json, sections: [...sec.values()], warnings, docTax, ledgerTax: input.ledgerOutputTax };
}
