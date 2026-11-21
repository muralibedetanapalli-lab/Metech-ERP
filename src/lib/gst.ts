/** Indian GST helpers. Pure functions (safe for client and server). Money in paise, rates in bps. */

export const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

/** Indian state name (as used in Dukaan addresses) → GST state code. */
export function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  for (const [code, label] of Object.entries(GST_STATES)) if (label.toLowerCase() === n) return code;
  if (n === "orissa") return "21";
  if (n === "pondicherry") return "34";
  return null;
}

export const GST_RATES_BPS = [0, 500, 1200, 1800, 2800, 300, 25];

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CODE_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Validates the GSTIN format and its checksum digit. */
export function isValidGstin(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CODE_CHARS.indexOf(g[i]);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  const check = CODE_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14];
}

export const stateFromGstin = (gstin: string | null | undefined) => (gstin && gstin.length >= 2 ? gstin.slice(0, 2) : null);

export interface GstLineInput {
  quantity: number;
  rate: number; // paise per unit, before tax
  discount?: number; // paise off the line
  taxRateBps: number;
}

export interface GstLine {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
}

/**
 * Tax for one line. Intra-state supply (supplier state = place of supply) splits the tax equally
 * into CGST + SGST (SGST takes the odd paisa); inter-state supply is all IGST.
 */
export function computeGstLine(line: GstLineInput, interState: boolean): GstLine {
  const taxable = Math.max(0, Math.round(line.quantity * line.rate) - (line.discount ?? 0));
  const tax = Math.round((taxable * line.taxRateBps) / 10_000);
  if (interState) return { taxable, cgst: 0, sgst: 0, igst: tax, amount: taxable + tax };
  const cgst = Math.floor(tax / 2);
  const sgst = tax - cgst;
  return { taxable, cgst, sgst, igst: 0, amount: taxable + tax };
}

export function computeInvoiceTotals(lines: GstLineInput[], supplierState: string, placeOfSupply: string) {
  const interState = supplierState !== placeOfSupply;
  const computed = lines.map((l) => computeGstLine(l, interState));
  const sum = (k: keyof GstLine) => computed.reduce((s, l) => s + l[k], 0);
  return {
    interState,
    lines: computed,
    taxableAmount: sum("taxable"),
    cgst: sum("cgst"),
    sgst: sum("sgst"),
    igst: sum("igst"),
    total: sum("amount"),
  };
}
