/** Invoice document types shared by server posting, screens and exports. */
export type DocType = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
export type DocKind = "SALES" | "PURCHASE";

export const DOC_TYPES: DocType[] = ["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"];

/** +1 when the document adds to what the party owes (or is owed), −1 when it reduces it. */
export const docSign = (t: DocType) => (t === "CREDIT_NOTE" ? -1 : 1);

export function docLabel(kind: DocKind, t: DocType, short = false): string {
  if (t === "CREDIT_NOTE") return kind === "SALES" ? "Credit note" : short ? "Credit note" : "Credit note (from vendor)";
  if (t === "DEBIT_NOTE") return kind === "SALES" ? "Debit note" : short ? "Debit note" : "Debit note (from vendor)";
  return kind === "SALES" ? "Invoice" : "Bill";
}

/** Number series per document type; sales invoices use the company prefix. */
export function docPrefix(kind: DocKind, t: DocType, invoicePrefix: string): string {
  if (kind === "SALES") return t === "CREDIT_NOTE" ? "CN" : t === "DEBIT_NOTE" ? "DN" : invoicePrefix;
  return t === "CREDIT_NOTE" ? "PCN" : t === "DEBIT_NOTE" ? "PDN" : "PB";
}

/** Status label: an unapplied credit note is "open" credit, a fully used one is "applied". */
export function statusLabel(t: DocType, status: string): string {
  if (t === "CREDIT_NOTE") return status === "PAID" ? "APPLIED" : status === "PARTIAL" ? "PART APPLIED" : status === "POSTED" ? "OPEN" : status;
  return status === "POSTED" ? "UNPAID" : status;
}
