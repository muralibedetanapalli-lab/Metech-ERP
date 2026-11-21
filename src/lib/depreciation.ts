/** Straight-line depreciation to date (whole months). */
export function bookValue(a: { cost: number; salvageValue: number; usefulLifeMonths: number; purchaseDate: Date }, asOf = new Date()) {
  const months = Math.max(0, (asOf.getUTCFullYear() - a.purchaseDate.getUTCFullYear()) * 12 + asOf.getUTCMonth() - a.purchaseDate.getUTCMonth());
  const dep = Math.min(a.cost - a.salvageValue, Math.round(((a.cost - a.salvageValue) * months) / Math.max(1, a.usefulLifeMonths)));
  return { depreciation: dep, value: a.cost - dep };
}
