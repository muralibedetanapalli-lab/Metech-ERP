import "server-only";
import { db, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { decryptSecret } from "@/server/crypto";
import { stateCodeFromName, isValidGstin } from "@/lib/gst";
import { istDay } from "@/server/dukaan/mapping";
import { systemAccountId } from "@/server/accounting/coa";
import { createInvoice, recordExpense, recordPayment, voidInvoice } from "@/server/accounting/documents";
import { zFeedEvent, zFeedPage, zFeedParty, type FeedEvent, type FeedLine, type FeedParty } from "./feed-contract";

const PAGE_SIZE = 200;
const MAX_PAGES = 50;

export type FeedFetcher = (path: string) => Promise<unknown>;
type Project = { id: string; code: string; name: string; baseUrl: string | null; apiKeyEnc: string | null; bankAccountId: string | null };

/** GET against the project's feed API with its service key. */
export function httpFeedFetcher(project: Project): FeedFetcher {
  if (!project.baseUrl || !project.apiKeyEnc) throw new AppError(400, "NOT_CONFIGURED", `Set the feed URL and API key for ${project.name} first`);
  const key = decryptSecret(project.apiKeyEnc);
  const base = project.baseUrl.endsWith("/") ? project.baseUrl : `${project.baseUrl}/`;
  return async (path) => {
    const url = new URL(path.replace(/^\//, ""), base);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`Could not reach ${project.name} at ${url.host}: ${cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err))}`);
    }
    const body = (await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;
    if (!res.ok) throw new Error(`${project.name} feed ${res.status}: ${body?.error?.message ?? res.statusText}`);
    return body?.data;
  };
}

const cursorKey = (projectId: string, feed: string) => `${projectId}:${feed}`;
const tagFor = (code: string) => code.toLowerCase();

/** Insert or update the CRM party for a project's customer / vendor. CRM notes and extra tags are kept. */
export async function upsertFeedParty(tx: Tx | typeof db, project: Project, p: FeedParty) {
  const gstin = p.gstin && isValidGstin(p.gstin) ? p.gstin : p.gstin || null;
  const stateCode = p.stateCode ?? (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null) ?? stateCodeFromName(p.state);
  const data = {
    kind: p.kind ?? (gstin ? "ORGANIZATION" : "PERSON"),
    name: p.name,
    email: p.email ?? null,
    phone: p.phone ?? null,
    gstin,
    stateCode,
    address: p.address ?? null,
    city: p.city ?? null,
    pincode: p.pincode ?? null,
    archived: !p.active,
    extSyncedAt: new Date(),
  } as const;
  const key = { extSource_extType_extId: { extSource: project.code, extType: "PARTY", extId: p.id } };
  const existing = await tx.party.findUnique({ where: key });
  const roles = { isCustomer: p.roles.includes("CUSTOMER") || (existing?.isCustomer ?? false), isVendor: p.roles.includes("VENDOR") || (existing?.isVendor ?? false) };
  if (existing) return tx.party.update({ where: { id: existing.id }, data: { ...data, ...roles, tags: Array.from(new Set([...existing.tags, tagFor(project.code)])) } });
  return tx.party.create({ data: { ...data, ...roles, tags: [tagFor(project.code)], extSource: project.code, extType: "PARTY", extId: p.id } });
}

/** Party behind an id used in an event; a placeholder is created if the parties feed has not sent it yet. */
async function partyFor(tx: Tx, project: Project, extId: string, role: "CUSTOMER" | "VENDOR") {
  const key = { extSource_extType_extId: { extSource: project.code, extType: "PARTY", extId } };
  const found = await tx.party.findUnique({ where: key });
  if (found) {
    if (role === "CUSTOMER" && !found.isCustomer) await tx.party.update({ where: { id: found.id }, data: { isCustomer: true } });
    if (role === "VENDOR" && !found.isVendor) await tx.party.update({ where: { id: found.id }, data: { isVendor: true } });
    return found;
  }
  return tx.party.create({
    data: { kind: "ORGANIZATION", name: `${project.name} ${role.toLowerCase()} ${extId.slice(-6)}`, extSource: project.code, extType: "PARTY", extId, tags: [tagFor(project.code)], isCustomer: role === "CUSTOMER", isVendor: role === "VENDOR" },
  });
}

async function accountByCode(tx: Tx, code: string | null | undefined, allowed: string[]) {
  if (!code) return null;
  const a = await tx.account.findUnique({ where: { code } });
  if (!a || !a.active) throw new AppError(400, "BAD_ACCOUNT", `Account code ${code} does not exist`);
  if (!allowed.includes(a.type)) throw new AppError(400, "BAD_ACCOUNT", `Account ${code} (${a.name}) cannot be used here`);
  return a.id;
}

async function docLines(tx: Tx, lines: FeedLine[], sales: boolean) {
  return Promise.all(
    lines.map(async (l) => ({
      description: l.description,
      hsnSac: l.hsnSac ?? null,
      quantity: l.quantity,
      rate: l.rate,
      discount: l.discount,
      taxRateBps: l.taxRateBps,
      accountId: await accountByCode(tx, l.accountCode, sales ? ["INCOME"] : ["EXPENSE", "ASSET"]),
    })),
  );
}

const findSale = (tx: Tx, number: string) => tx.invoice.findUnique({ where: { kind_number: { kind: "SALES", number } } });
const findBill = (tx: Tx, partyId: string, ref: string, docType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE" = "INVOICE") =>
  tx.invoice.findFirst({ where: { kind: "PURCHASE", partyId, vendorRef: ref, docType, status: { not: "VOID" } }, orderBy: { createdAt: "desc" } });

/**
 * Apply one feed event inside the caller's transaction: sales documents keep the app's numbers (it issued them),
 * purchases get Metech numbers with the vendor's number as reference; everything is tagged with the project.
 * Returns what was created, e.g. "invoice:<id>".
 */
async function applyEvent(tx: Tx, project: Project, e: FeedEvent): Promise<string | null> {
  const date = istDay(("date" in e.data && e.data.date) || e.occurredAt);
  const company = await tx.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} });
  const bank = project.bankAccountId ?? (await systemAccountId(tx, "BANK"));
  const cc = project.id;
  switch (e.type) {
    case "sale.invoice":
    case "sale.credit_note":
    case "sale.debit_note": {
      const d = e.data;
      const party = await partyFor(tx, project, d.customerId, "CUSTOMER");
      const docType = e.type === "sale.invoice" ? "INVOICE" : e.type === "sale.credit_note" ? "CREDIT_NOTE" : "DEBIT_NOTE";
      let originalInvoiceId: string | null = null;
      if (e.type !== "sale.invoice" && e.data.invoiceNumber) {
        const orig = await findSale(tx, e.data.invoiceNumber);
        if (!orig) throw new AppError(400, "NO_INVOICE", `Invoice ${e.data.invoiceNumber} for note ${d.number} has not been received`);
        originalInvoiceId = orig.id;
      }
      const inv = await createInvoice(
        {
          kind: "SALES",
          docType,
          partyId: party.id,
          date,
          dueDate: e.type === "sale.invoice" && e.data.dueDate ? istDay(e.data.dueDate) : null,
          placeOfSupply: d.placeOfSupply ?? party.stateCode ?? company.stateCode,
          notes: e.type === "sale.invoice" ? (e.data.notes ?? null) : null,
          noteReason: e.type === "sale.invoice" ? null : e.data.reason,
          originalInvoiceId,
          costCentreId: cc,
          lines: await docLines(tx, d.lines, true),
        },
        undefined,
        { tx, number: d.number },
      );
      return `invoice:${inv.id}`;
    }
    case "sale.cancelled": {
      const inv = await findSale(tx, e.data.number);
      if (!inv) throw new AppError(400, "NO_INVOICE", `Cannot cancel ${e.data.number}: it has not been received`);
      if (inv.costCentreId !== cc) throw new AppError(400, "WRONG_PROJECT", `${e.data.number} belongs to another project`);
      await voidInvoice(inv.id, e.data.reason ?? `Cancelled in ${project.name}`, tx);
      return `void:${inv.id}`;
    }
    case "purchase.bill":
    case "purchase.credit_note":
    case "purchase.debit_note": {
      const party = await partyFor(tx, project, e.data.vendorId, "VENDOR");
      const ref = e.type === "purchase.bill" ? e.data.billNumber : e.data.noteNumber;
      const docType = e.type === "purchase.bill" ? "INVOICE" : e.type === "purchase.credit_note" ? "CREDIT_NOTE" : "DEBIT_NOTE";
      let originalInvoiceId: string | null = null;
      if (e.type !== "purchase.bill" && e.data.billNumber) {
        const orig = await findBill(tx, party.id, e.data.billNumber);
        if (!orig) throw new AppError(400, "NO_BILL", `Bill ${e.data.billNumber} for vendor note ${ref} has not been received`);
        originalInvoiceId = orig.id;
      }
      const inv = await createInvoice(
        {
          kind: "PURCHASE",
          docType,
          partyId: party.id,
          date,
          dueDate: e.type === "purchase.bill" && e.data.dueDate ? istDay(e.data.dueDate) : null,
          placeOfSupply: company.stateCode,
          vendorRef: ref,
          notes: e.type === "purchase.bill" ? (e.data.notes ?? null) : null,
          noteReason: e.type === "purchase.bill" ? null : e.data.reason,
          originalInvoiceId,
          costCentreId: cc,
          lines: await docLines(tx, e.data.lines, false),
        },
        undefined,
        { tx },
      );
      return `invoice:${inv.id}`;
    }
    case "purchase.cancelled": {
      const party = await partyFor(tx, project, e.data.vendorId, "VENDOR");
      const bill = await findBill(tx, party.id, e.data.billNumber);
      if (!bill) throw new AppError(400, "NO_BILL", `Cannot cancel bill ${e.data.billNumber}: it has not been received`);
      await voidInvoice(bill.id, e.data.reason ?? `Cancelled in ${project.name}`, tx);
      return `void:${bill.id}`;
    }
    case "payment.received": {
      const d = e.data;
      const party = await partyFor(tx, project, d.customerId, "CUSTOMER");
      const allocations = [];
      for (const a of d.allocations) {
        const inv = await findSale(tx, a.invoiceNumber);
        if (!inv) throw new AppError(400, "NO_INVOICE", `Payment for invoice ${a.invoiceNumber}, which has not been received`);
        allocations.push({ invoiceId: inv.id, amount: a.amount });
      }
      const p = await recordPayment({ kind: "RECEIPT", date, partyId: party.id, amount: d.amount, bankAccountId: bank, mode: d.mode ?? "BANK", reference: d.reference ?? null, notes: `From ${project.name}`, allocations }, undefined, tx);
      return `payment:${p.id}`;
    }
    case "payment.made": {
      const d = e.data;
      const party = await partyFor(tx, project, d.vendorId, "VENDOR");
      const allocations = [];
      for (const a of d.allocations) {
        const bill = await findBill(tx, party.id, a.billNumber);
        if (!bill) throw new AppError(400, "NO_BILL", `Payment for bill ${a.billNumber}, which has not been received`);
        allocations.push({ invoiceId: bill.id, amount: a.amount });
      }
      const p = await recordPayment({ kind: "PAYMENT", date, partyId: party.id, amount: d.amount, bankAccountId: bank, mode: d.mode ?? "BANK", reference: d.reference ?? null, notes: `From ${project.name}`, allocations }, undefined, tx);
      return `payment:${p.id}`;
    }
    case "expense": {
      const d = e.data;
      const vendor = d.vendorId ? await partyFor(tx, project, d.vendorId, "VENDOR") : null;
      const accountId = (await accountByCode(tx, d.accountCode, ["EXPENSE"])) ?? (await systemAccountId(tx, "MISC_EXPENSE"));
      const x = await recordExpense(
        { date, accountId, paidFromId: bank, partyId: vendor?.id ?? null, costCentreId: cc, amount: d.amount, gstRateBps: d.gstRateBps, interState: d.interState, description: d.description, reference: d.reference ?? null },
        undefined,
        tx,
      );
      return `expense:${x.id}`;
    }
  }
}

/** Apply one raw event once: validates it, skips ids already applied, and records the result. */
export async function applyFeedEvent(project: Project, raw: unknown): Promise<"posted" | "duplicate"> {
  const parsed = zFeedEvent.safeParse(raw);
  const rawId = (raw as { id?: unknown })?.id;
  if (!parsed.success) throw new AppError(400, "BAD_EVENT", `Event ${typeof rawId === "string" ? rawId : "?"} is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const e = parsed.data;
  return db.$transaction(async (tx) => {
    const seen = await tx.syncEvent.findUnique({ where: { projectId_eventId: { projectId: project.id, eventId: e.id } } });
    if (seen) return "duplicate";
    let result: string | null;
    try {
      result = await applyEvent(tx, project, e);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Event ${e.id} (${e.type}): ${msg}`);
    }
    await tx.syncEvent.create({ data: { projectId: project.id, eventId: e.id, type: e.type, result } });
    return "posted";
  });
}

export interface FeedSyncResult {
  runId: string;
  ok: boolean;
  parties: number;
  events: number;
  posted: number;
  skipped: number;
  error?: string;
}

/**
 * Pull parties, then events, from a FEED_V1 project and apply them. Stops at the first event that cannot be
 * applied (so a payment never lands before its invoice); the next run retries from that page.
 */
export async function runFeedSync(projectId: string, trigger: "MANUAL" | "CRON" | "CLI" | "TEST", fetcher?: FeedFetcher): Promise<FeedSyncResult> {
  const project = await db.costCentre.findUniqueOrThrow({ where: { id: projectId } });
  if (project.connector !== "FEED_V1") throw new AppError(400, "NOT_FEED", `${project.name} is not connected with the project feed`);
  const running = await db.syncRun.findFirst({ where: { projectId, finishedAt: null, startedAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (running) throw new AppError(409, "BUSY", `A ${project.name} sync is already running`);
  const run = await db.syncRun.create({ data: { trigger, projectId } });
  const result: FeedSyncResult = { runId: run.id, ok: false, parties: 0, events: 0, posted: 0, skipped: 0 };
  try {
    const get = fetcher ?? httpFeedFetcher(project);
    const pages = async (feed: "parties" | "events", each: (item: unknown) => Promise<void>) => {
      let cursor = (await db.syncCursor.findUnique({ where: { feed: cursorKey(projectId, feed) } }))?.cursor ?? null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = zFeedPage.parse(await get(`${feed}?limit=${PAGE_SIZE}${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`));
        for (const item of page.items) await each(item);
        if (page.nextCursor) {
          cursor = page.nextCursor;
          await db.syncCursor.upsert({ where: { feed: cursorKey(projectId, feed) }, create: { feed: cursorKey(projectId, feed), cursor }, update: { cursor } });
        }
        if (!page.hasMore) break;
      }
    };
    await pages("parties", async (raw) => {
      const p = zFeedParty.safeParse(raw);
      if (!p.success) throw new AppError(400, "BAD_PARTY", `Party ${(raw as { id?: string })?.id ?? "?"} is not valid: ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      await upsertFeedParty(db, project, p.data);
      result.parties++;
    });
    await pages("events", async (raw) => {
      const r = await applyFeedEvent(project, raw);
      result.events++;
      if (r === "posted") result.posted++;
      else result.skipped++;
    });
    result.ok = true;
    await db.costCentre.update({ where: { id: projectId }, data: { lastSyncAt: new Date() } });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    await db.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: result.ok, parties: result.parties, events: result.events, posted: result.posted, skipped: result.skipped, error: result.error?.slice(0, 1000) ?? null },
    });
  }
  return result;
}

export function resetFeedCursors(projectId: string) {
  return db.syncCursor.deleteMany({ where: { feed: { in: [cursorKey(projectId, "parties"), cursorKey(projectId, "events")] } } });
}
