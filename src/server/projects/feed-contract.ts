import { z } from "zod";

/**
 * Metech project feed, version 1: what a project app (TentOs, …) exposes so Metech ERP can pull its
 * customers, vendors, invoices, bills, payments and expenses. Human-readable spec: docs/PROJECT-FEED.md.
 *
 *   GET {baseUrl}/parties?limit=1..500&after=<cursor>   → { data: { items: FeedParty[], nextCursor, hasMore } }
 *   GET {baseUrl}/events?limit=1..500&after=<cursor>    → { data: { items: FeedEvent[], nextCursor, hasMore } }
 *   Authorization: Bearer <service key>
 *
 * Money is integer paise, GST rates are basis points (1800 = 18%), dates are YYYY-MM-DD (IST calendar day)
 * or ISO timestamps. Event ids must be unique and stable: Metech applies each id once.
 */

const id = z.string().trim().min(1).max(100);
const paise = z.number().int();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "date must be YYYY-MM-DD or an ISO timestamp")
  .optional()
  .nullable();
const stateCode = z.string().regex(/^\d{2}$/, "state codes are 2-digit GST codes");

export const zFeedParty = z.object({
  id,
  kind: z.enum(["PERSON", "ORGANIZATION"]).optional(),
  roles: z.array(z.enum(["CUSTOMER", "VENDOR"])).default(["CUSTOMER"]),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  gstin: z.string().trim().toUpperCase().max(15).optional().nullable(),
  stateCode: stateCode.optional().nullable(),
  state: z.string().trim().max(60).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  pincode: z.string().trim().max(10).optional().nullable(),
  active: z.boolean().default(true),
});
export type FeedParty = z.infer<typeof zFeedParty>;

export const zFeedLine = z.object({
  description: z.string().trim().min(1).max(300),
  hsnSac: z.string().trim().max(10).optional().nullable(),
  quantity: z.number().positive().default(1),
  rate: paise.min(0),
  discount: paise.min(0).default(0),
  taxRateBps: z.number().int().min(0).max(2800),
  /** Optional Metech account code (e.g. "4000" services income, "5310" cloud); defaults to Sales / Purchases. */
  accountCode: z.string().trim().max(10).optional().nullable(),
});
export type FeedLine = z.infer<typeof zFeedLine>;
const lines = z.array(zFeedLine).min(1).max(500);
const docNumber = z.string().trim().min(1).max(40);

const ev = <T extends string, D extends z.ZodTypeAny>(type: T, data: D) => z.object({ id, type: z.literal(type), occurredAt: z.string().min(10), data });

export const zFeedEvent = z.discriminatedUnion("type", [
  ev("sale.invoice", z.object({ number: docNumber, customerId: id, date: day, dueDate: day, placeOfSupply: stateCode.optional().nullable(), lines, notes: z.string().max(1000).optional().nullable() })),
  ev("sale.credit_note", z.object({ number: docNumber, customerId: id, invoiceNumber: docNumber.optional().nullable(), reason: z.string().trim().min(1).max(200), date: day, placeOfSupply: stateCode.optional().nullable(), lines })),
  ev("sale.debit_note", z.object({ number: docNumber, customerId: id, invoiceNumber: docNumber.optional().nullable(), reason: z.string().trim().min(1).max(200), date: day, placeOfSupply: stateCode.optional().nullable(), lines })),
  ev("sale.cancelled", z.object({ number: docNumber, reason: z.string().trim().max(200).optional().nullable() })),
  ev("purchase.bill", z.object({ vendorId: id, billNumber: docNumber, date: day, dueDate: day, lines, notes: z.string().max(1000).optional().nullable() })),
  ev("purchase.credit_note", z.object({ vendorId: id, noteNumber: docNumber, billNumber: docNumber.optional().nullable(), reason: z.string().trim().min(1).max(200), date: day, lines })),
  ev("purchase.debit_note", z.object({ vendorId: id, noteNumber: docNumber, billNumber: docNumber.optional().nullable(), reason: z.string().trim().min(1).max(200), date: day, lines })),
  ev("purchase.cancelled", z.object({ vendorId: id, billNumber: docNumber, reason: z.string().trim().max(200).optional().nullable() })),
  ev(
    "payment.received",
    z.object({ customerId: id, amount: paise.positive(), date: day, mode: z.string().max(20).optional().nullable(), reference: z.string().max(80).optional().nullable(), allocations: z.array(z.object({ invoiceNumber: docNumber, amount: paise.positive() })).default([]) }),
  ),
  ev(
    "payment.made",
    z.object({ vendorId: id, amount: paise.positive(), date: day, mode: z.string().max(20).optional().nullable(), reference: z.string().max(80).optional().nullable(), allocations: z.array(z.object({ billNumber: docNumber, amount: paise.positive() })).default([]) }),
  ),
  ev(
    "expense",
    z.object({
      amount: paise.positive(),
      gstRateBps: z.number().int().min(0).max(2800).default(0),
      interState: z.boolean().default(false),
      description: z.string().trim().min(1).max(300),
      accountCode: z.string().trim().max(10).optional().nullable(),
      vendorId: id.optional().nullable(),
      reference: z.string().max(80).optional().nullable(),
      date: day,
    }),
  ),
]);
export type FeedEvent = z.infer<typeof zFeedEvent>;
export const FEED_EVENT_TYPES = zFeedEvent.options.map((o) => o.shape.type.value);

export const zFeedPage = z.object({ items: z.array(z.unknown()), nextCursor: z.string().nullable().optional(), hasMore: z.boolean().default(false) });
