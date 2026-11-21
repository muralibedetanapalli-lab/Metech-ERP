import type { AccountType } from "../../generated/prisma/client";

/** Accounts the app posts to automatically. Codes follow a simple 4-digit scheme (1 assets … 5 expenses). */
export const SYSTEM_ACCOUNTS = {
  CASH: { code: "1000", name: "Cash in hand", type: "ASSET", subtype: "CASH" },
  BANK: { code: "1010", name: "Bank — current account", type: "ASSET", subtype: "BANK" },
  RECEIVABLE: { code: "1100", name: "Trade receivables (debtors)", type: "ASSET", subtype: "RECEIVABLE" },
  INVENTORY: { code: "1200", name: "Inventory", type: "ASSET", subtype: "INVENTORY" },
  INPUT_CGST: { code: "1300", name: "Input CGST", type: "ASSET", subtype: "TAX" },
  INPUT_SGST: { code: "1301", name: "Input SGST", type: "ASSET", subtype: "TAX" },
  INPUT_IGST: { code: "1302", name: "Input IGST", type: "ASSET", subtype: "TAX" },
  TDS_RECEIVABLE: { code: "1310", name: "TDS receivable", type: "ASSET", subtype: "TAX" },
  CASHFREE_CLEARING: { code: "1400", name: "Cashfree clearing (Dukaan online collections)", type: "ASSET", subtype: "CLEARING" },
  FIXED_ASSETS: { code: "1500", name: "Fixed assets", type: "ASSET", subtype: "FIXED_ASSET" },
  ACC_DEPRECIATION: { code: "1590", name: "Accumulated depreciation", type: "ASSET", subtype: "FIXED_ASSET" },

  PAYABLE: { code: "2000", name: "Trade payables (creditors)", type: "LIABILITY", subtype: "PAYABLE" },
  OUTPUT_CGST: { code: "2100", name: "Output CGST", type: "LIABILITY", subtype: "TAX" },
  OUTPUT_SGST: { code: "2101", name: "Output SGST", type: "LIABILITY", subtype: "TAX" },
  OUTPUT_IGST: { code: "2102", name: "Output IGST", type: "LIABILITY", subtype: "TAX" },
  TDS_PAYABLE: { code: "2110", name: "TDS payable", type: "LIABILITY", subtype: "TAX" },
  SALARY_PAYABLE: { code: "2200", name: "Salaries payable", type: "LIABILITY", subtype: "PAYABLE" },
  PF_PAYABLE: { code: "2210", name: "PF payable", type: "LIABILITY", subtype: "PAYABLE" },
  PT_PAYABLE: { code: "2220", name: "Professional tax payable", type: "LIABILITY", subtype: "PAYABLE" },
  DUKAAN_SHOP_PAYABLE: { code: "2300", name: "Dukaan — payable to shops", type: "LIABILITY", subtype: "PAYABLE" },
  DUKAAN_RIDER_PAYABLE: { code: "2310", name: "Dukaan — rider wallets (payable)", type: "LIABILITY", subtype: "PAYABLE" },
  DUKAAN_DEALER_PAYABLE: { code: "2320", name: "Dukaan — dealer commission payable", type: "LIABILITY", subtype: "PAYABLE" },
  DUKAAN_CUSTOMER_REFUNDS: { code: "2330", name: "Dukaan — refunds due to customers", type: "LIABILITY", subtype: "PAYABLE" },

  CAPITAL: { code: "3000", name: "Owner's capital", type: "EQUITY", subtype: null },
  RETAINED_EARNINGS: { code: "3100", name: "Retained earnings", type: "EQUITY", subtype: null },
  OPENING_BALANCE: { code: "3900", name: "Opening balance adjustment", type: "EQUITY", subtype: null },

  SALES: { code: "4000", name: "Sales — services", type: "INCOME", subtype: null },
  SALES_GOODS: { code: "4010", name: "Sales — goods", type: "INCOME", subtype: null },
  DUKAAN_COMMISSION: { code: "4100", name: "Dukaan — platform commission", type: "INCOME", subtype: null },
  DUKAAN_DELIVERY_INCOME: { code: "4110", name: "Dukaan — delivery fees & other marketplace income (net)", type: "INCOME", subtype: null },
  OTHER_INCOME: { code: "4900", name: "Other income", type: "INCOME", subtype: null },

  PURCHASES: { code: "5000", name: "Purchases", type: "EXPENSE", subtype: null },
  DUKAAN_DEALER_COMMISSION: { code: "5100", name: "Dukaan — dealer commission", type: "EXPENSE", subtype: null },
  DUKAAN_DELIVERY_COST: { code: "5110", name: "Dukaan — delivery cost & marketplace adjustments", type: "EXPENSE", subtype: null },
  DUKAAN_REFUNDS: { code: "5120", name: "Dukaan — refunds on delivered orders", type: "EXPENSE", subtype: null },
  PAYMENT_GATEWAY_FEES: { code: "5130", name: "Payment gateway charges", type: "EXPENSE", subtype: null },
  SALARIES: { code: "5200", name: "Salaries & wages", type: "EXPENSE", subtype: null },
  EMPLOYER_PF: { code: "5210", name: "Employer PF contribution", type: "EXPENSE", subtype: null },
  RENT: { code: "5300", name: "Rent", type: "EXPENSE", subtype: null },
  CLOUD_HOSTING: { code: "5310", name: "Cloud & software (Azure, SaaS)", type: "EXPENSE", subtype: null },
  MARKETING: { code: "5320", name: "Marketing & advertising", type: "EXPENSE", subtype: null },
  TRAVEL: { code: "5330", name: "Travel & conveyance", type: "EXPENSE", subtype: null },
  OFFICE: { code: "5340", name: "Office & admin expenses", type: "EXPENSE", subtype: null },
  PROFESSIONAL_FEES: { code: "5350", name: "Professional & legal fees", type: "EXPENSE", subtype: null },
  BANK_CHARGES: { code: "5360", name: "Bank charges", type: "EXPENSE", subtype: null },
  DEPRECIATION: { code: "5400", name: "Depreciation", type: "EXPENSE", subtype: null },
  MISC_EXPENSE: { code: "5900", name: "Miscellaneous expenses", type: "EXPENSE", subtype: null },
} as const satisfies Record<string, { code: string; name: string; type: AccountType; subtype: string | null }>;

export type SystemKey = keyof typeof SYSTEM_ACCOUNTS;
