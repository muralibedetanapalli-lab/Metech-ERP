import type { Role } from "@/server/auth/jwt";

/** What each role may change. Every signed-in user can read every module. */
export type Permission = "crm.write" | "accounting.write" | "erp.write" | "dukaan.sync" | "admin";

const MATRIX: Record<Role, Permission[]> = {
  OWNER: ["crm.write", "accounting.write", "erp.write", "dukaan.sync", "admin"],
  ACCOUNTANT: ["accounting.write", "erp.write", "dukaan.sync"],
  SALES: ["crm.write"],
  VIEWER: [],
};

export const can = (role: Role, perm: Permission) => MATRIX[role].includes(perm);

export const ROLES: Role[] = ["OWNER", "ACCOUNTANT", "SALES", "VIEWER"];

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner / Admin",
  ACCOUNTANT: "Accountant",
  SALES: "Sales",
  VIEWER: "Viewer",
};
