import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Table } from "@/server/accounting/reports";

const toNumber = (v: unknown, money?: boolean) => (money && typeof v === "number" ? v / 100 : v);

export async function toXlsx(t: Table, company: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = company;
  const ws = wb.addWorksheet(t.title.slice(0, 30));
  ws.addRow([company]).font = { bold: true, size: 12 };
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  if (t.subtitle) ws.addRow([t.subtitle]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  const header = ws.addRow(t.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } }));
  for (const r of t.rows) ws.addRow(t.columns.map((c) => toNumber(r[c.key], c.money) ?? ""));
  for (const r of t.totals ?? []) ws.addRow(t.columns.map((c) => toNumber(r[c.key], c.money) ?? "")).font = { bold: true };
  t.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(48, Math.max(12, c.label.length + 4, c.key === "account" || c.key === "party" || c.key === "narration" ? 32 : 0));
    if (c.money) col.numFmt = "#,##0.00";
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** StandardFonts are WinAnsi: replace characters they cannot encode. */
export const pdfSafe = (s: string) => s.replace(/₹/g, "Rs ").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");

export async function toPdf(t: Table, company: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = t.columns.length > 6 ? [842, 595] : [595, 842];
  const margin = 32;
  const width = pageSize[0] - margin * 2;
  // Text columns get double the width of money columns.
  const weights = t.columns.map((c) => (c.money ? 1 : c.key === "account" || c.key === "party" || c.key === "narration" ? 2.4 : 1.2));
  const unit = width / weights.reduce((a, b) => a + b, 0);
  const xs: number[] = [];
  weights.reduce((x, w, i) => ((xs[i] = x), x + w * unit), margin);
  const clip = (s: string, w: number, f = font, size = 8) => {
    let out = pdfSafe(s);
    while (out.length > 1 && f.widthOfTextAtSize(out, size) > w - 4) out = out.slice(0, -1);
    return out;
  };
  const cell = (v: unknown, money?: boolean) => (v === null || v === undefined ? "" : money && typeof v === "number" ? (v / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v));

  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;
  const drawRow = (r: Record<string, unknown>, f = font) =>
    t.columns.forEach((c, i) => {
      const text = clip(cell(r[c.key], c.money), weights[i] * unit, f);
      const x = c.money ? xs[i] + weights[i] * unit - 3 - f.widthOfTextAtSize(text, 8) : xs[i] + 3;
      page.drawText(text, { x, y, size: 8, font: f });
    });
  const header = () => {
    page.drawRectangle({ x: margin, y: y - 4, width, height: 15, color: rgb(0.08, 0.5, 0.24) });
    t.columns.forEach((c, i) => page.drawText(clip(c.label, weights[i] * unit, bold), { x: xs[i] + 3, y, size: 8, font: bold, color: rgb(1, 1, 1) }));
    y -= 16;
  };
  const ensure = () => {
    if (y < margin + 14) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - margin;
      header();
    }
  };
  page.drawText(pdfSafe(company), { x: margin, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) });
  y -= 18;
  page.drawText(pdfSafe(t.title), { x: margin, y, size: 16, font: bold });
  y -= 14;
  if (t.subtitle) {
    page.drawText(pdfSafe(t.subtitle), { x: margin, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 18;
  }
  header();
  t.rows.forEach((r, idx) => {
    ensure();
    if (idx % 2 === 0) page.drawRectangle({ x: margin, y: y - 4, width, height: 13, color: rgb(0.95, 0.97, 0.95) });
    drawRow(r);
    y -= 13;
  });
  if (!t.rows.length) {
    page.drawText("No data for the selected period.", { x: margin, y, size: 10, font });
    y -= 14;
  }
  for (const r of t.totals ?? []) {
    ensure();
    page.drawLine({ start: { x: margin, y: y + 10 }, end: { x: margin + width, y: y + 10 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    drawRow(r, bold);
    y -= 14;
  }
  return Buffer.from(await pdf.save());
}
