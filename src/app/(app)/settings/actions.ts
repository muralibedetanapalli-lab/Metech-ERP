"use server";

import { db } from "@/server/db";
import { requirePermission, requireUser } from "@/server/auth/session";
import { hashPassword, passwordPolicy, verifyPassword } from "@/server/auth/password";
import { req, run, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { isValidGstin } from "@/lib/gst";
import { ROLES } from "@/lib/permissions";
import type { Role } from "@/server/auth/jwt";
import type { ActionState } from "@/lib/action-state";

export async function saveCompany(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("admin");
    const gstin = str(fd, "gstin")?.toUpperCase() ?? null;
    if (gstin && !isValidGstin(gstin)) throw new AppError(400, "GSTIN", "GSTIN is not valid");
    const data = {
      name: req(fd, "name", "Company name"),
      legalName: str(fd, "legalName"),
      gstin,
      pan: str(fd, "pan")?.toUpperCase() ?? null,
      stateCode: gstin ? gstin.slice(0, 2) : (str(fd, "stateCode") ?? "36"),
      address: str(fd, "address"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      invoicePrefix: (str(fd, "invoicePrefix") ?? "MS").replace(/[^A-Za-z0-9-]/g, "").slice(0, 8) || "MS",
    };
    await db.companySettings.upsert({ where: { id: "company" }, create: data, update: data });
    return "Company profile saved";
  }, ["/settings"]);
}

export async function createUser(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requirePermission("admin");
    const password = req(fd, "password", "Password");
    if (!passwordPolicy.test(password)) throw new AppError(400, "WEAK", passwordPolicy.message);
    const role = req(fd, "role") as Role;
    if (!ROLES.includes(role)) throw new AppError(400, "ROLE", "Unknown role");
    await db.user.create({ data: { name: req(fd, "name", "Name"), email: req(fd, "email", "Email").toLowerCase(), role, passwordHash: await hashPassword(password) } });
    return "User created";
  }, ["/settings"]);
}

export async function updateUser(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requirePermission("admin");
    const id = req(fd, "id");
    const role = req(fd, "role") as Role;
    const active = fd.get("active") === "on";
    if (!ROLES.includes(role)) throw new AppError(400, "ROLE", "Unknown role");
    if (id === me.id && (role !== "OWNER" || !active)) throw new AppError(400, "SELF", "You cannot remove your own owner access");
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    const password = str(fd, "password");
    if (password && !passwordPolicy.test(password)) throw new AppError(400, "WEAK", passwordPolicy.message);
    const changed = user.role !== role || user.active !== active || Boolean(password);
    await db.user.update({
      where: { id },
      data: { role, active, ...(password ? { passwordHash: await hashPassword(password) } : {}), ...(changed ? { sessionVersion: { increment: 1 } } : {}) },
    });
    return "User updated";
  }, ["/settings"]);
}

export async function changeOwnPassword(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUser();
    const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await verifyPassword(req(fd, "current", "Current password"), user.passwordHash))) throw new AppError(400, "WRONG", "Current password is wrong");
    const next = req(fd, "next", "New password");
    if (!passwordPolicy.test(next)) throw new AppError(400, "WEAK", passwordPolicy.message);
    // Keep this session valid: the version only changes when an owner edits the user.
    await db.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(next) } });
    return "Password changed";
  });
}
