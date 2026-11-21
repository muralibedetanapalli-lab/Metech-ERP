import { AppError } from "@/server/errors";
import { parseRupees } from "@/lib/money";
import { dayDate } from "@/lib/dates";

export function parseStatementCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") out.push(cur.trim()), (cur = "");
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseStatementDate(s: string) {
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return dayDate(`${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dayDate(s.slice(0, 10));
  throw new AppError(400, "BAD_DATE", `Cannot read date "${s}"`);
}

export function parseStatementCsv(text: string) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new AppError(400, "EMPTY", "The CSV has no rows");
  const header = parseStatementCsvLine(lines[0]).map((h) => h.toLowerCase());
  const split = header.some((h) => h.includes("withdrawal") || h.includes("debit"));
  const idx = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = idx("date");
  const iDesc = idx("description", "narration", "particulars", "remarks");
  const iRef = idx("reference", "ref", "cheque", "utr");
  const iAmt = idx("amount");
  const iW = idx("withdrawal", "debit");
  const iD = idx("deposit", "credit");
  if (iDate < 0 || iDesc < 0 || (!split && iAmt < 0)) throw new AppError(400, "HEADERS", "CSV needs Date, Description and Amount (or Withdrawal/Deposit) columns");
  return lines.slice(1).map((l) => {
    const c = parseStatementCsvLine(l);
    const amount = split ? parseRupees(c[iD] || "0") - parseRupees(c[iW] || "0") : parseRupees(c[iAmt]);
    return { date: parseStatementDate(c[iDate]), description: c[iDesc] || "(no description)", reference: iRef >= 0 ? c[iRef] || null : null, amount };
  });
}

