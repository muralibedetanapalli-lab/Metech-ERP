import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { computeInvoiceTotals } from "@/lib/gst";
import { nextNumber, postEntry, voidEntry, type LineInput } from "./ledger";
import { systemAccountId } from "./coa";
import { docLabel, docPrefix, docSign } from "@/lib/doc-types";

// ───────────────────────────── Sales & purchase invoices ─────────────────────────────

export const zInvoiceInput = z.object({
  kind: z.enum(["SALES", "PURCHASE"]),
  docType: z.enum(["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"]).default("INVOICE"),
  /** Credit / debit notes: the invoice being adjusted (optional, same party and kind). */
  originalInvoiceId: z.string().optional().nullable(),
  noteReason: z.string().trim().max(200).optional().nullable(),
  partyId: z.string().min(1, "Choose a customer or vendor"),
  date: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  placeOfSupply: z.string().regex(/^\d{2}$/, "Place of supply must be a 2-digit GST state code"),
  vendorRef: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  costCentreId: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.string().optional().nullable(),
        description: z.string().trim().min(1, "Line description is required").max(300),
        hsnSac: z.string().trim().max(10).optional().nullable(),
        quantity: z.number().positive(),
        rate: z.number().int().min(0),
        discount: z.number().int().min(0).default(0),
        taxRateBps: z.number().int().min(0).max(2800),
        accountId: z.string().optional().nullable(),
      }),
    )
    .min(1, "Add at least one line"),
});
export type InvoiceInput = z.input<typeof zInvoiceInput>;

/**
 * Create and post an invoice, credit note or debit note. GST is split CGST+SGST (same state) or IGST (other state).
 * A credit note posts the invoice entry reversed; when it names an original invoice, it is applied to that
 * invoice's balance straight away (up to what is still due) and any rest stays as open credit for the party.
 */
export async function createInvoice(raw: InvoiceInput, userId?: string) {
  const input = zInvoiceInput.parse(raw);
  return db.$transaction(async (tx) => {
    const company = await tx.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} });
    const party = await tx.party.findUniqueOrThrow({ where: { id: input.partyId } });
    const sales = input.kind === "SALES";
    // Purchases: the supplier is the other party, so compare their state with ours (place of supply).
    const supplierState = sales ? company.stateCode : (party.stateCode ?? company.stateCode);
    const totals = computeInvoiceTotals(input.lines, supplierState, input.placeOfSupply);
    const label = docLabel(input.kind, input.docType, true);
    if (totals.total <= 0) throw new AppError(400, "ZERO_INVOICE", `${label} total must be more than zero`);
    const note = input.docType !== "INVOICE";
    if (!note && (input.originalInvoiceId || input.noteReason)) throw new AppError(400, "NOT_A_NOTE", "Only credit and debit notes refer to an original invoice");
    if (note && !input.noteReason) throw new AppError(400, "NOTE_REASON", "Give a reason for the note (e.g. goods returned, discount, rate difference)");
    const original = input.originalInvoiceId ? await tx.invoice.findUniqueOrThrow({ where: { id: input.originalInvoiceId } }) : null;
    if (original) {
      if (original.partyId !== party.id) throw new AppError(400, "WRONG_PARTY", `Invoice ${original.number} belongs to another party`);
      if (original.kind !== input.kind || original.docType !== "INVOICE") throw new AppError(400, "WRONG_KIND", `${original.number} is not a ${input.kind === "SALES" ? "sales invoice" : "purchase bill"}`);
      if (original.status === "VOID") throw new AppError(400, "VOID_INVOICE", `Invoice ${original.number} is void`);
      if (input.date < original.date) throw new AppError(400, "NOTE_BEFORE_INVOICE", `The note cannot be dated before invoice ${original.number}`);
    }

    const defaultAccount = await systemAccountId(tx, sales ? "SALES" : "PURCHASES");
    const number = await nextNumber(tx, docPrefix(input.kind, input.docType, company.invoicePrefix), input.date);
    const invoice = await tx.invoice.create({
      data: {
        kind: input.kind,
        docType: input.docType,
        originalInvoiceId: original?.id ?? null,
        noteReason: note ? input.noteReason : null,
        number,
        partyId: party.id,
        date: input.date,
        dueDate: input.dueDate ?? null,
        placeOfSupply: input.placeOfSupply,
        status: "POSTED",
        taxableAmount: totals.taxableAmount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        total: totals.total,
        vendorRef: input.vendorRef ?? null,
        notes: input.notes ?? null,
        lines: {
          create: input.lines.map((l, i) => ({
            itemId: l.itemId || null,
            description: l.description,
            hsnSac: l.hsnSac || null,
            quantity: l.quantity,
            rate: l.rate,
            discount: l.discount,
            taxRateBps: l.taxRateBps,
            accountId: l.accountId || defaultAccount,
            sortOrder: i,
            ...totals.lines[i],
          })),
        },
      },
      include: { lines: true },
    });

    // Sales:    Dr Receivable total | Cr income (taxable per line) | Cr Output GST
    // Purchase: Dr expense (taxable per line) | Dr Input GST | Cr Payable total
    // Credit notes post the same lines with the opposite sign.
    const sign = (sales ? -1 : 1) * docSign(input.docType);
    const lines: LineInput[] = [
      { key: sales ? "RECEIVABLE" : "PAYABLE", amount: -sign * totals.total, partyId: party.id },
      ...invoice.lines.map((l) => ({ accountId: l.accountId, amount: sign * l.taxable, partyId: party.id, costCentreId: input.costCentreId ?? null, memo: l.description })),
      { key: sales ? "OUTPUT_CGST" : "INPUT_CGST", amount: sign * totals.cgst },
      { key: sales ? "OUTPUT_SGST" : "INPUT_SGST", amount: sign * totals.sgst },
      { key: sales ? "OUTPUT_IGST" : "INPUT_IGST", amount: sign * totals.igst },
    ];
    const { entry } = await postEntry(tx, {
      date: input.date,
      narration: `${note ? `${sales ? "Sales" : "Purchase"} ${label.toLowerCase()}` : sales ? "Sales invoice" : "Purchase bill"} ${number} — ${party.name}${original ? ` (against ${original.number})` : ""}`,
      source: sales ? "SALES_INVOICE" : "PURCHASE_INVOICE",
      sourceRef: `invoice:${invoice.id}`,
      createdById: userId,
      lines,
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { journalEntryId: entry.id } });

    // Stock for tracked items: purchases add, sales remove; credit notes are returns, so the other way round.
    for (const l of invoice.lines) {
      if (!l.itemId) continue;
      const item = await tx.item.findUnique({ where: { id: l.itemId } });
      if (!item?.trackStock) continue;
      const qty = (sales ? -l.quantity : l.quantity) * docSign(input.docType);
      const reason = input.docType === "CREDIT_NOTE" ? (sales ? "SALES_RETURN" : "PURCHASE_RETURN") : sales ? "SALE" : "PURCHASE";
      await tx.item.update({ where: { id: item.id }, data: { stock: { increment: qty } } });
      await tx.stockMovement.create({ data: { itemId: item.id, date: input.date, quantity: qty, reason, reference: number } });
    }
    // A credit note against an invoice settles that invoice first.
    if (original && input.docType === "CREDIT_NOTE") {
      const apply = Math.min(original.total - original.amountPaid, totals.total);
      if (apply > 0) {
        const paid = original.amountPaid + apply;
        await tx.invoice.update({ where: { id: original.id }, data: { amountPaid: paid, status: paid >= original.total ? "PAID" : "PARTIAL" } });
        await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: apply, status: apply >= totals.total ? "PAID" : "PARTIAL" } });
      }
    }
    if (sales && !party.isCustomer) await tx.party.update({ where: { id: party.id }, data: { isCustomer: true } });
    if (!sales && !party.isVendor) await tx.party.update({ where: { id: party.id }, data: { isVendor: true } });
    return invoice;
  });
}

export async function voidInvoice(invoiceId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { allocations: true, lines: true, adjustments: { where: { status: { not: "VOID" } } } } });
    if (inv.status === "VOID") return inv;
    if (inv.allocations.length) throw new AppError(409, "HAS_PAYMENTS", "Void the payments against this invoice first");
    if (inv.adjustments.length) throw new AppError(409, "HAS_NOTES", `Void the credit / debit notes against this invoice first (${inv.adjustments.map((n) => n.number).join(", ")})`);
    if (inv.journalEntryId) await voidEntry(tx, inv.journalEntryId, reason);
    for (const l of inv.lines) {
      if (!l.itemId) continue;
      const item = await tx.item.findUnique({ where: { id: l.itemId } });
      if (!item?.trackStock) continue;
      const qty = (inv.kind === "SALES" ? l.quantity : -l.quantity) * docSign(inv.docType);
      await tx.item.update({ where: { id: item.id }, data: { stock: { increment: qty } } });
      await tx.stockMovement.create({ data: { itemId: item.id, quantity: qty, reason: "ADJUSTMENT", reference: `Void ${inv.number}` } });
    }
    // Undo a credit note's application to its original invoice.
    if (inv.docType === "CREDIT_NOTE" && inv.originalInvoiceId && inv.amountPaid > 0) {
      const orig = await tx.invoice.findUniqueOrThrow({ where: { id: inv.originalInvoiceId } });
      const paid = Math.max(0, orig.amountPaid - inv.amountPaid);
      await tx.invoice.update({ where: { id: orig.id }, data: { amountPaid: paid, status: paid <= 0 ? "POSTED" : paid >= orig.total ? "PAID" : "PARTIAL" } });
    }
    return tx.invoice.update({ where: { id: inv.id }, data: { status: "VOID" } });
  });
}

// ───────────────────────────── Receipts & payments ─────────────────────────────

export const zPaymentInput = z.object({
  kind: z.enum(["RECEIPT", "PAYMENT"]),
  date: z.coerce.date(),
  partyId: z.string().optional().nullable(),
  amount: z.number().int().positive("Amount must be more than zero"),
  bankAccountId: z.string().min(1, "Choose a bank or cash account"),
  /** Counter account when not settling a party balance (e.g. capital introduced, bank charges). */
  counterAccountId: z.string().optional().nullable(),
  mode: z.string().default("BANK"),
  reference: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(z.object({ invoiceId: z.string(), amount: z.number().int().positive() })).default([]),
});
export type PaymentInput = z.input<typeof zPaymentInput>;

/**
 * Receipt: Dr bank / Cr receivable (party). Payment: Dr payable (party) / Cr bank.
 * Allocations mark invoices PARTIAL or PAID; any unallocated amount stays on the party as an advance.
 */
export async function recordPayment(raw: PaymentInput, userId?: string) {
  const input = zPaymentInput.parse(raw);
  return db.$transaction(async (tx) => {
    const receipt = input.kind === "RECEIPT";
    if (!input.partyId && !input.counterAccountId) throw new AppError(400, "NO_COUNTERPARTY", "Choose a party or a counter account");
    const allocated = input.allocations.reduce((s, a) => s + a.amount, 0);
    if (allocated > input.amount) throw new AppError(400, "OVER_ALLOCATED", "Allocated more than the payment amount");
    for (const a of input.allocations) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      if (inv.partyId !== input.partyId) throw new AppError(400, "WRONG_PARTY", `Invoice ${inv.number} belongs to another party`);
      if (inv.kind !== (receipt ? "SALES" : "PURCHASE")) throw new AppError(400, "WRONG_KIND", `Invoice ${inv.number} cannot be settled by this ${receipt ? "receipt" : "payment"}`);
      if (inv.status === "VOID") throw new AppError(400, "VOID_INVOICE", `Invoice ${inv.number} is void`);
      if (inv.docType === "CREDIT_NOTE") throw new AppError(400, "CREDIT_NOTE", `${inv.number} is a credit note; it reduces what is due and cannot take a ${receipt ? "receipt" : "payment"}`);
      if (a.amount > inv.total - inv.amountPaid) throw new AppError(400, "OVERPAID", `Only ${(inv.total - inv.amountPaid) / 100} is due on ${inv.number}`);
    }
    const number = await nextNumber(tx, receipt ? "RV" : "PV", input.date);
    const party = input.partyId ? await tx.party.findUniqueOrThrow({ where: { id: input.partyId } }) : null;
    const sign = receipt ? 1 : -1;
    const counter: LineInput = input.counterAccountId
      ? { accountId: input.counterAccountId, amount: -sign * input.amount, partyId: party?.id ?? null }
      : { key: receipt ? "RECEIVABLE" : "PAYABLE", amount: -sign * input.amount, partyId: party!.id };
    const { entry } = await postEntry(tx, {
      date: input.date,
      narration: `${receipt ? "Receipt" : "Payment"} ${number}${party ? ` — ${party.name}` : ""}${input.reference ? ` (${input.reference})` : ""}`,
      source: receipt ? "RECEIPT" : "PAYMENT",
      sourceRef: `payment:${number}`,
      createdById: userId,
      lines: [{ accountId: input.bankAccountId, amount: sign * input.amount, memo: input.reference ?? null }, counter],
    });
    const payment = await tx.payment.create({
      data: {
        kind: input.kind,
        number,
        date: input.date,
        partyId: party?.id ?? null,
        amount: input.amount,
        bankAccountId: input.bankAccountId,
        mode: input.mode,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        journalEntryId: entry.id,
        allocations: { create: input.allocations },
      },
    });
    for (const a of input.allocations) {
      const inv = await tx.invoice.update({ where: { id: a.invoiceId }, data: { amountPaid: { increment: a.amount } } });
      await tx.invoice.update({ where: { id: inv.id }, data: { status: inv.amountPaid >= inv.total ? "PAID" : "PARTIAL" } });
    }
    return payment;
  });
}

// ───────────────────────────── Expenses ─────────────────────────────

export const zExpenseInput = z.object({
  date: z.coerce.date(),
  accountId: z.string().min(1, "Choose an expense account"),
  paidFromId: z.string().min(1, "Choose the bank or cash account it was paid from"),
  partyId: z.string().optional().nullable(),
  costCentreId: z.string().optional().nullable(),
  amount: z.number().int().positive(),
  gstRateBps: z.number().int().min(0).max(2800).default(0),
  interState: z.boolean().default(false),
  description: z.string().trim().min(1).max(300),
  reference: z.string().trim().max(80).optional().nullable(),
});
export type ExpenseInput = z.infer<typeof zExpenseInput>;

/** Dr expense (+ input GST) / Cr bank or cash. */
export async function recordExpense(raw: ExpenseInput, userId?: string) {
  const input = zExpenseInput.parse(raw);
  return db.$transaction(async (tx) => {
    const gst = Math.round((input.amount * input.gstRateBps) / 10_000);
    const half = Math.floor(gst / 2);
    const expense = await tx.expense.create({
      data: { ...input, partyId: input.partyId || null, costCentreId: input.costCentreId || null, gstAmount: gst, reference: input.reference ?? null },
    });
    const { entry } = await postEntry(tx, {
      date: input.date,
      narration: `Expense — ${input.description}`,
      source: "EXPENSE",
      sourceRef: `expense:${expense.id}`,
      createdById: userId,
      lines: [
        { accountId: input.accountId, amount: input.amount, partyId: input.partyId || null, costCentreId: input.costCentreId || null, memo: input.description },
        ...(input.interState ? [{ key: "INPUT_IGST" as const, amount: gst }] : [{ key: "INPUT_CGST" as const, amount: half }, { key: "INPUT_SGST" as const, amount: gst - half }]),
        { accountId: input.paidFromId, amount: -(input.amount + gst), memo: input.reference ?? null },
      ],
    });
    return tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: entry.id } });
  });
}
