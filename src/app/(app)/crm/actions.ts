"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { req, run, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { isValidGstin } from "@/lib/gst";
import { parseRupees } from "@/lib/money";
import type { ActionState } from "@/lib/action-state";

function partyData(fd: FormData) {
  const gstin = str(fd, "gstin")?.toUpperCase() ?? null;
  if (gstin && !isValidGstin(gstin)) throw new AppError(400, "GSTIN", "GSTIN is not valid (check the 15 characters)");
  return {
    kind: (str(fd, "kind") === "PERSON" ? "PERSON" : "ORGANIZATION") as "PERSON" | "ORGANIZATION",
    name: req(fd, "name", "Name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    gstin,
    pan: str(fd, "pan")?.toUpperCase() ?? null,
    stateCode: gstin ? gstin.slice(0, 2) : str(fd, "stateCode"),
    address: str(fd, "address"),
    city: str(fd, "city"),
    pincode: str(fd, "pincode"),
    isCustomer: fd.get("isCustomer") === "on",
    isVendor: fd.get("isVendor") === "on",
    orgId: str(fd, "orgId"),
    tags: (str(fd, "tags") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    notes: str(fd, "notes"),
  };
}

export async function createParty(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    await requirePermission("crm.write");
    id = (await db.party.create({ data: partyData(fd) })).id;
  }, ["/crm/contacts"]);
  if (r.ok && fd.get("open") === "1") redirect(`/crm/contacts/${id}`);
  return r;
}

export async function updateParty(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("crm.write");
    const id = req(fd, "id");
    const existing = await db.party.findUniqueOrThrow({ where: { id } });
    const data = partyData(fd);
    // Dukaan-synced records: name/phone/email come from Dukaan and would be overwritten on the next sync.
    await db.party.update({ where: { id }, data: existing.extSource ? { ...data, name: existing.name, email: existing.email, phone: existing.phone, tags: Array.from(new Set([...data.tags, ...existing.tags.filter((t) => t.startsWith("dukaan"))])) } : data });
    return "Contact updated";
  }, ["/crm/contacts"]);
}

const zActivity = z.object({
  type: z.enum(["NOTE", "CALL", "MEETING", "EMAIL", "TASK", "FOLLOW_UP"]),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().max(4000).optional().nullable(),
  partyId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
});

export async function addActivity(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("crm.write");
    const a = zActivity.parse({
      type: str(fd, "type") ?? "NOTE",
      subject: str(fd, "subject") ?? (str(fd, "body")?.slice(0, 80) || ""),
      body: str(fd, "body"),
      partyId: str(fd, "partyId"),
      dealId: str(fd, "dealId"),
      assigneeId: str(fd, "assigneeId") ?? user.id,
      dueAt: str(fd, "dueAt"),
    });
    const isNote = a.type === "NOTE" || (!a.dueAt && (a.type === "CALL" || a.type === "MEETING" || a.type === "EMAIL"));
    await db.activity.create({
      data: {
        ...a,
        partyId: a.partyId || null,
        dealId: a.dealId || null,
        dueAt: a.dueAt ? new Date(a.dueAt) : null,
        // Notes and logged calls/meetings without a due date are already done.
        doneAt: isNote ? new Date() : null,
      },
    });
    return a.dueAt ? "Reminder added" : "Logged";
  }, ["/crm/tasks", "/crm/contacts", "/crm/deals", "/"]);
}

export async function toggleActivity(fd: FormData) {
  await requirePermission("crm.write");
  const id = req(fd, "id");
  const a = await db.activity.findUniqueOrThrow({ where: { id } });
  await db.activity.update({ where: { id }, data: { doneAt: a.doneAt ? null : new Date() } });
  revalidatePath("/crm/tasks");
  revalidatePath("/");
  if (a.partyId) revalidatePath(`/crm/contacts/${a.partyId}`);
}

export async function createDeal(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("crm.write");
    let partyId = str(fd, "partyId");
    const newCompany = str(fd, "newCompany");
    if (!partyId && newCompany) partyId = (await db.party.create({ data: { kind: "ORGANIZATION", name: newCompany, tags: ["lead"] } })).id;
    const stageId = str(fd, "stageId") ?? (await db.pipelineStage.findFirstOrThrow({ orderBy: { sortOrder: "asc" } })).id;
    await db.deal.create({
      data: {
        title: req(fd, "title", "Title"),
        partyId,
        stageId,
        value: parseRupees(fd.get("value")),
        source: str(fd, "source"),
        expectedClose: str(fd, "expectedClose") ? new Date(str(fd, "expectedClose")!) : null,
        ownerId: user.id,
      },
    });
    return "Deal created";
  }, ["/crm/deals", "/crm/leads", "/"]);
}

export async function moveDeal(fd: FormData) {
  await requirePermission("crm.write");
  const id = req(fd, "id");
  const stage = await db.pipelineStage.findUniqueOrThrow({ where: { id: req(fd, "stageId") } });
  await db.deal.update({ where: { id }, data: { stageId: stage.id, closedAt: stage.outcome === "OPEN" ? null : new Date() } });
  revalidatePath("/crm/deals");
  revalidatePath("/crm/leads");
}
