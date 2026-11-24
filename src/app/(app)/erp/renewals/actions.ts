"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/session";
import { req, run, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { createRenewal, deleteRenewal, renew, setRenewalStatus, updateRenewal, type RenewalInput } from "@/server/erp/renewals";
import { parseRupees } from "@/lib/money";
import { dayDate } from "@/lib/dates";
import type { ActionState } from "@/lib/action-state";

const PATHS = ["/erp/renewals", "/", "/accounting/expenses", "/erp/projects"];

const int = (fd: FormData, k: string, d: number) => {
  const v = str(fd, k);
  const n = v === null ? d : Number(v);
  if (!Number.isInteger(n)) throw new AppError(400, "NUMBER", `${k} must be a whole number`);
  return n;
};

function fromForm(fd: FormData): RenewalInput {
  return {
    name: req(fd, "name", "Name"),
    category: (str(fd, "category") ?? "OTHER") as RenewalInput["category"],
    provider: str(fd, "provider"),
    reference: str(fd, "reference"),
    vendorId: str(fd, "vendorId"),
    costCentreId: str(fd, "costCentreId"),
    accountId: str(fd, "accountId"),
    startDate: dayDate(req(fd, "startDate", "Start date")),
    renewalDate: dayDate(req(fd, "renewalDate", "Renewal date")),
    cycleMonths: int(fd, "cycleMonths", 12),
    amount: str(fd, "amount") ? parseRupees(fd.get("amount")) : 0,
    gstRateBps: int(fd, "gstRateBps", 1800),
    autoRenew: fd.get("autoRenew") === "on",
    remindDays: int(fd, "remindDays", 30),
    notes: str(fd, "notes"),
  };
}

export async function saveRenewal(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  let newId = "";
  const r = await run(async () => {
    await requirePermission("erp.write");
    if (id) {
      await updateRenewal(id, fromForm(fd));
      return "Saved";
    }
    newId = (await createRenewal(fromForm(fd))).id;
  }, [...PATHS, ...(id ? [`/erp/renewals/${id}`] : [])]);
  if (r.ok && newId) redirect(`/erp/renewals/${newId}`);
  return r;
}

export async function renewAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = req(fd, "id");
  return run(async () => {
    const book = fd.get("bookExpense") === "on";
    const user = await requirePermission(book ? "accounting.write" : "erp.write");
    const next = str(fd, "newRenewalDate");
    const r = await renew(
      id,
      {
        paidOn: dayDate(req(fd, "paidOn", "Paid on")),
        newRenewalDate: next ? dayDate(next) : null,
        amount: str(fd, "amount") ? parseRupees(fd.get("amount")) : 0,
        gstRateBps: int(fd, "gstRateBps", 0),
        interState: fd.get("interState") === "on",
        bookExpense: book,
        paidFromId: str(fd, "paidFromId"),
        note: str(fd, "note"),
      },
      user.id,
    );
    return `Renewed until ${r.renewalDate.toISOString().slice(0, 10)}${book ? "; expense booked" : ""}`;
  }, [...PATHS, `/erp/renewals/${id}`]);
}

export async function setStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const id = req(fd, "id");
  return run(async () => {
    await requirePermission("erp.write");
    const status = req(fd, "status") === "CANCELLED" ? "CANCELLED" : "ACTIVE";
    await setRenewalStatus(id, status);
    return status === "CANCELLED" ? "Marked as cancelled (not renewing)" : "Reactivated";
  }, [...PATHS, `/erp/renewals/${id}`]);
}

export async function deleteAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run(async () => {
    await requirePermission("erp.write");
    await deleteRenewal(req(fd, "id"));
  }, PATHS);
  if (r.ok) redirect("/erp/renewals");
  return r;
}
