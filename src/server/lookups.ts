import "server-only";
import { db } from "@/server/db";

/** Small option lists used by forms. */
export const lookups = {
  accounts: () => db.account.findMany({ where: { active: true }, select: { id: true, code: true, name: true, type: true, subtype: true }, orderBy: { code: "asc" } }),
  bankAccounts: () => db.account.findMany({ where: { active: true, subtype: { in: ["BANK", "CASH", "CLEARING"] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  parties: (where: { isCustomer?: boolean; isVendor?: boolean } = {}) =>
    db.party.findMany({ where: { archived: false, ...where }, select: { id: true, name: true, stateCode: true, gstin: true }, orderBy: { name: "asc" }, take: 2000 }),
  costCentres: () => db.costCentre.findMany({ where: { active: true }, select: { id: true, code: true, name: true, kind: true }, orderBy: { code: "asc" } }),
  items: () => db.item.findMany({ where: { active: true }, select: { id: true, sku: true, name: true, hsnSac: true, salePrice: true, purchasePrice: true, taxRateBps: true, unit: true }, orderBy: { name: "asc" } }),
};

export const accountLabel = (a: { code: string; name: string }) => `${a.code} · ${a.name}`;
