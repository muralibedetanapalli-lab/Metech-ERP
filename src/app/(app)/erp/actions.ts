"use server";

import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";
import { req, run, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { runPayroll } from "@/server/erp/payroll";
import { parseRupees } from "@/lib/money";
import { dayDate } from "@/lib/dates";
import type { ActionState } from "@/lib/action-state";

const num = (fd: FormData, k: string, d = 0) => {
  const v = str(fd, k);
  const n = v === null ? d : Number(v);
  if (!Number.isFinite(n)) throw new AppError(400, "NUMBER", `${k} must be a number`);
  return n;
};

export async function saveItem(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("erp.write");
    const opening = num(fd, "openingStock");
    const item = await db.item.create({
      data: {
        sku: req(fd, "sku", "SKU").toUpperCase(),
        name: req(fd, "name", "Name"),
        kind: str(fd, "kind") === "SERVICE" ? "SERVICE" : "GOODS",
        hsnSac: str(fd, "hsnSac"),
        unit: str(fd, "unit") ?? "nos",
        salePrice: parseRupees(fd.get("salePrice")),
        purchasePrice: parseRupees(fd.get("purchasePrice")),
        taxRateBps: num(fd, "taxRateBps", 1800),
        trackStock: str(fd, "kind") !== "SERVICE",
        reorderLevel: num(fd, "reorderLevel"),
        stock: opening,
      },
    });
    if (opening) await db.stockMovement.create({ data: { itemId: item.id, quantity: opening, reason: "OPENING" } });
    return "Item added";
  }, ["/erp/items"]);
}

export async function adjustStock(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("erp.write");
    const itemId = req(fd, "itemId");
    const qty = num(fd, "quantity");
    if (!qty) throw new AppError(400, "QTY", "Enter a non-zero quantity (negative to reduce)");
    await db.$transaction([
      db.item.update({ where: { id: itemId }, data: { stock: { increment: qty } } }),
      db.stockMovement.create({ data: { itemId, quantity: qty, reason: "ADJUSTMENT", reference: str(fd, "reference") } }),
    ]);
    return "Stock adjusted";
  }, ["/erp/items"]);
}

export async function saveAsset(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("erp.write");
    await db.asset.create({
      data: {
        code: req(fd, "code", "Asset code").toUpperCase(),
        name: req(fd, "name", "Name"),
        category: req(fd, "category", "Category"),
        purchaseDate: dayDate(req(fd, "purchaseDate", "Purchase date")),
        cost: parseRupees(fd.get("cost")),
        usefulLifeMonths: num(fd, "usefulLifeMonths", 36),
        salvageValue: parseRupees(fd.get("salvageValue")),
        location: str(fd, "location"),
        assignedTo: str(fd, "assignedTo"),
        notes: str(fd, "notes"),
      },
    });
    return "Asset added";
  }, ["/erp/assets"]);
}

export async function saveEmployee(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("erp.write");
    const basic = parseRupees(fd.get("basic"));
    const hra = parseRupees(fd.get("hra"));
    const otherAllow = parseRupees(fd.get("otherAllow"));
    await db.employee.create({
      data: {
        code: req(fd, "code", "Employee code").toUpperCase(),
        name: req(fd, "name", "Name"),
        email: str(fd, "email"),
        phone: str(fd, "phone"),
        designation: str(fd, "designation"),
        department: str(fd, "department"),
        joinDate: dayDate(req(fd, "joinDate", "Joining date")),
        pan: str(fd, "pan")?.toUpperCase() ?? null,
        basic,
        hra,
        otherAllow,
        monthlyCtc: basic + hra + otherAllow,
        pfApplicable: fd.get("pfApplicable") === "on",
      },
    });
    return "Employee added";
  }, ["/erp/employees"]);
}

export async function payrollAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requirePermission("accounting.write");
    const r = await runPayroll(req(fd, "period", "Month"), user.id);
    return `Payroll for ${r.period}: ${r.count} payslips, net ${(r.net / 100).toLocaleString("en-IN")} posted to salaries payable`;
  }, ["/erp/employees", "/accounting/journal", "/"]);
}

export async function saveCostCentre(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("erp.write");
    const start = str(fd, "startDate");
    const end = str(fd, "endDate");
    await db.costCentre.create({
      data: {
        code: req(fd, "code", "Code").toUpperCase(),
        name: req(fd, "name", "Name"),
        kind: str(fd, "kind") ?? "PROJECT",
        budget: str(fd, "budget") ? parseRupees(fd.get("budget")) : null,
        startDate: start ? dayDate(start) : null,
        endDate: end ? dayDate(end) : null,
      },
    });
    return "Saved";
  }, ["/erp/projects"]);
}
