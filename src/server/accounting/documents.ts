import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { computeInvoiceTotals } from "@/lib/gst";
import { nextNumber, postEntry, voidEntry, type LineInput } from "./ledger";
import { systemAccountId } from "./coa";

// ───────────────────────────── Sales & purchase invoices ─────────────────────────────

export const zInvoiceInput = z.object({
  kind: z.enum(["SALES", "PURCHASE"]),
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
export type InvoiceInput = z.infer<typeof zInvoiceInput>;

/** Create and post an invoice: GST is split CGST+SGST (same state) or IGST (other state). */
export async function createInvoice(raw: InvoiceInput, userId?: string) {
  const input = zInvoiceInput.parse(raw);
  return db.$transaction(async (tx) => {
    const company = await tx.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} });
    const party = await tx.party.findUniqueOrThrow({ where: { id: input.partyId } });
    const sales = input.kind === "SALES";
    // Purchases: the supplier is the other party, so compare their state with ours (place of supply).
    const supplierState = sales ? company.stateCode : (party.stateCode ?? company.stateCode);
    const totals = computeInvoiceTotals(input.lines, supplierState, input.placeOfSupply);
    if (totals.total <= 0) throw new AppError(400, "ZERO_INVOICE", "Invoice total must be more than zero");

    const defaultAccount = await systemAccountId(tx, sales ? "SALES" : "PURCHASES");
    const number = sales ? await nextNumber(tx, company.invoicePrefix, input.date) : await nextNumber(tx, "PB", input.date);
    const invoice = await tx.invoice.create({
      data: {
        kind: input.kind,
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
    const sign = sales ? -1 : 1;
    const lines: LineInput[] = [
      { key: sales ? "RECEIVABLE" : "PAYABLE", amount: -sign * totals.total, partyId: party.id },
      ...invoice.lines.map((l) => ({ accountId: l.accountId, amount: sign * l.taxable, partyId: party.id, costCentreId: input.costCentreId ?? null, memo: l.description })),
      { key: sales ? "OUTPUT_CGST" : "INPUT_CGST", amount: sign * totals.cgst },
      { key: sales ? "OUTPUT_SGST" : "INPUT_SGST", amount: sign * totals.sgst },
      { key: sales ? "OUTPUT_IGST" : "INPUT_IGST", amount: sign * totals.igst },
    ];
    const { entry } = await postEntry(tx, {
      date: input.date,
      narration: `${sales ? "Sales invoice" : "Purchase bill"} ${number} — ${party.name}`,
      source: sales ? "SALES_INVOICE" : "PURCHASE_INVOICE",
      sourceRef: `invoice:${invoice.id}`,
      createdById: userId,
      lines,
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { journalEntryId: entry.id } });

    // Stock for tracked items: purchases add, sales remove.
    for (const l of invoice.lines) {
      if (!l.itemId) continue;
      const item = await tx.item.findUnique({ where: { id: l.itemId } });
      if (!item?.trackStock) continue;
      const qty = sales ? -l.quantity : l.quantity;
      await tx.item.update({ where: { id: item.id }, data: { stock: { increment: qty } } });
      await tx.stockMovement.create({ data: { itemId: item.id, date: input.date, quantity: qty, reason: sales ? "SALE" : "PURCHASE", reference: number } });
    }
    if (sales && !party.isCustomer) await tx.party.update({ where: { id: party.id }, data: { isCustomer: true } });
    if (!sales && !party.isVendor) await tx.party.update({ where: { id: party.id }, data: { isVendor: true } });
    return invoice;
  });
}

export async function voidInvoice(invoiceId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { allocations: true, lines: true } });
    if (inv.status === "VOID") return inv;
    if (inv.allocations.length) throw new AppError(409, "HAS_PAYMENTS", "Void the payments against this invoice first");
    if (inv.journalEntryId) await voidEntry(tx, inv.journalEntryId, reason);
    for (const l of inv.lines) {
      if (!l.itemId) continue;
      const item = await tx.item.findUnique({ where: { id: l.itemId } });
      if (!item?.trackStock) continue;
      const qty = inv.kind === "SALES" ? l.quantity : -l.quantity;
      await tx.item.update({ where: { id: item.id }, data: { stock: { increment: qty } } });
      await tx.stockMovement.create({ data: { itemId: item.id, quantity: qty, reason: "ADJUSTMENT", reference: `Void ${inv.number}` } });
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
export type PaymentInput = z.infer<typeof zPaymentInput>;

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
