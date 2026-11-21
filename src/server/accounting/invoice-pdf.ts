import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/server/db";
import { pdfSafe } from "@/server/export";
import { GST_STATES } from "@/lib/gst";

const amt = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** GST tax invoice (or purchase bill record) as an A4 PDF. */
export async function invoicePdf(invoiceId: string) {
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { party: true, lines: { orderBy: { sortOrder: "asc" } }, originalInvoice: { select: { number: true, date: true } } },
  });
  const co = await db.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  const M = 40;
  let y = 800;
  const text = (s: string, x: number, yy: number, size = 9, f = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(pdfSafe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, x: number, yy: number, size = 9, f = font) => text(s, x - f.widthOfTextAtSize(pdfSafe(s), size), yy, size, f);

  const sales = inv.kind === "SALES";
  text(co.legalName ?? co.name, M, y, 16, bold);
  const heading =
    inv.docType === "CREDIT_NOTE" ? "CREDIT NOTE" : inv.docType === "DEBIT_NOTE" ? "DEBIT NOTE" : sales ? (inv.party.gstin ? "TAX INVOICE" : "INVOICE") : "PURCHASE BILL";
  right(heading, 555, y, 14, bold);
  y -= 16;
  for (const l of [co.address, co.gstin ? `GSTIN ${co.gstin}` : null, [co.email, co.phone].filter(Boolean).join(" · ") || null].filter(Boolean) as string[]) {
    text(l, M, y, 9);
    y -= 12;
  }
  let ry = 784;
  for (const [k, v] of [
    ["Number", inv.number],
    ["Date", inv.date.toISOString().slice(0, 10)],
    ...(inv.docType === "INVOICE" ? [["Due", inv.dueDate?.toISOString().slice(0, 10) ?? "-"]] : []),
    ...(inv.originalInvoice ? [["Against invoice", `${inv.originalInvoice.number} dt ${inv.originalInvoice.date.toISOString().slice(0, 10)}`]] : []),
    ...(inv.noteReason ? [["Reason", inv.noteReason]] : []),
    ["Place of supply", `${inv.placeOfSupply} ${GST_STATES[inv.placeOfSupply] ?? ""}`],
    ...(inv.vendorRef ? [["Supplier bill", inv.vendorRef]] : []),
  ]) {
    right(`${k}: ${v}`, 555, ry);
    ry -= 12;
  }
  y = Math.min(y, ry) - 14;
  text(sales ? "Bill to" : "Supplier", M, y, 9, bold, rgb(0.4, 0.4, 0.4));
  y -= 13;
  text(inv.party.name, M, y, 11, bold);
  y -= 13;
  for (const l of [[inv.party.address, inv.party.city, inv.party.pincode].filter(Boolean).join(", "), inv.party.gstin ? `GSTIN ${inv.party.gstin}` : "", inv.party.stateCode ? `State ${inv.party.stateCode} ${GST_STATES[inv.party.stateCode] ?? ""}` : ""].filter(Boolean)) {
    text(l, M, y);
    y -= 12;
  }
  y -= 10;

  const inter = inv.igst > 0;
  const cols = [
    { label: "#", x: M, w: 18 },
    { label: "Description", x: M + 18, w: 170 },
    { label: "HSN/SAC", x: M + 188, w: 50 },
    { label: "Qty", x: M + 238, w: 35, r: true },
    { label: "Rate", x: M + 273, w: 60, r: true },
    { label: "Taxable", x: M + 333, w: 62, r: true },
    { label: "GST %", x: M + 395, w: 35, r: true },
    { label: inter ? "IGST" : "CGST+SGST", x: M + 430, w: 50, r: true },
    { label: "Amount", x: M + 480, w: 35, r: true },
  ];
  page.drawRectangle({ x: M, y: y - 4, width: 515, height: 16, color: rgb(0.08, 0.5, 0.24) });
  for (const c of cols.filter((c) => !c.r)) text(c.label, c.x + 2, y, 8, bold, rgb(1, 1, 1));
  for (const c of cols.filter((c) => c.r)) page.drawText(pdfSafe(c.label), { x: c.x + c.w - bold.widthOfTextAtSize(pdfSafe(c.label), 8), y, size: 8, font: bold, color: rgb(1, 1, 1) });
  y -= 18;
  inv.lines.forEach((l, i) => {
    let d = pdfSafe(l.description);
    while (font.widthOfTextAtSize(d, 8) > 165) d = d.slice(0, -1);
    text(String(i + 1), cols[0].x + 2, y, 8);
    text(d, cols[1].x + 2, y, 8);
    text(l.hsnSac ?? "", cols[2].x + 2, y, 8);
    right(String(l.quantity), cols[3].x + cols[3].w, y, 8);
    right(amt(l.rate), cols[4].x + cols[4].w, y, 8);
    right(amt(l.taxable), cols[5].x + cols[5].w, y, 8);
    right(`${l.taxRateBps / 100}%`, cols[6].x + cols[6].w, y, 8);
    right(amt(l.igst + l.cgst + l.sgst), cols[7].x + cols[7].w, y, 8);
    right(amt(l.amount), 555, y, 8);
    y -= 14;
    page.drawLine({ start: { x: M, y: y + 9 }, end: { x: 555, y: y + 9 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
  });
  y -= 8;
  const totals: [string, number][] = [["Taxable value", inv.taxableAmount], ...(inter ? ([["IGST", inv.igst]] as [string, number][]) : ([["CGST", inv.cgst], ["SGST", inv.sgst]] as [string, number][])), ["Total", inv.total]];
  if (inv.amountPaid) totals.push(["Paid", inv.amountPaid], ["Balance due", inv.total - inv.amountPaid]);
  for (const [k, v] of totals) {
    const b = k === "Total" || k === "Balance due";
    right(k, 470, y, 9, b ? bold : font);
    right(`Rs ${amt(v)}`, 555, y, 9, b ? bold : font);
    y -= 13;
  }
  if (inv.notes) {
    y -= 10;
    text("Notes", M, y, 9, bold);
    y -= 12;
    for (const line of inv.notes.split("\n").slice(0, 8)) {
      text(line.slice(0, 110), M, y);
      y -= 11;
    }
  }
  text("This is a computer-generated document.", M, 40, 8, font, rgb(0.5, 0.5, 0.5));
  if (inv.status === "VOID") page.drawText("VOID", { x: 200, y: 420, size: 90, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.25 });
  return { bytes: Buffer.from(await pdf.save()), filename: `${inv.number.replace(/\//g, "-")}.pdf` };
}
