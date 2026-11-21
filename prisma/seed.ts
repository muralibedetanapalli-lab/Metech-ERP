/**
 * Seed: company profile, chart of accounts, CRM pipeline stages and the first users.
 * Development logins (change them before any shared deployment):
 *   owner@metech.local / Metech@123   (Owner)
 *   accounts@metech.local / Metech@123 (Accountant)
 *   sales@metech.local / Metech@123   (Sales)
 * In production set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD; demo users are not created there.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { SYSTEM_ACCOUNTS } from "../src/server/accounting/coa-data";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

export const PIPELINE = [
  { name: "New lead", sortOrder: 1, outcome: "OPEN", isLead: true },
  { name: "Contacted", sortOrder: 2, outcome: "OPEN", isLead: true },
  { name: "Qualified", sortOrder: 3, outcome: "OPEN", isLead: false },
  { name: "Proposal sent", sortOrder: 4, outcome: "OPEN", isLead: false },
  { name: "Negotiation", sortOrder: 5, outcome: "OPEN", isLead: false },
  { name: "Won", sortOrder: 6, outcome: "WON", isLead: false },
  { name: "Lost", sortOrder: 7, outcome: "LOST", isLead: false },
];

async function main() {
  const prod = process.env.NODE_ENV === "production";
  await db.companySettings.upsert({ where: { id: "company" }, create: { name: "Metech Solutions", stateCode: "36" }, update: {} });
  for (const [key, a] of Object.entries(SYSTEM_ACCOUNTS)) {
    await db.account.upsert({ where: { systemKey: key }, create: { systemKey: key, code: a.code, name: a.name, type: a.type, subtype: a.subtype }, update: {} });
  }
  for (const s of PIPELINE) await db.pipelineStage.upsert({ where: { name: s.name }, create: s, update: {} });

  const users: { email: string; name: string; role: "OWNER" | "ACCOUNTANT" | "SALES"; password: string }[] = [];
  if (prod) {
    if (!process.env.SEED_OWNER_EMAIL || !process.env.SEED_OWNER_PASSWORD) throw new Error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD to seed production");
    users.push({ email: process.env.SEED_OWNER_EMAIL, name: "Owner", role: "OWNER", password: process.env.SEED_OWNER_PASSWORD });
  } else {
    users.push(
      { email: "owner@metech.local", name: "Metech Owner", role: "OWNER", password: "Metech@123" },
      { email: "accounts@metech.local", name: "Accounts Team", role: "ACCOUNTANT", password: "Metech@123" },
      { email: "sales@metech.local", name: "Sales Team", role: "SALES", password: "Metech@123" },
    );
  }
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 12) },
      update: {},
    });
  }
  console.log(`Seeded company, ${Object.keys(SYSTEM_ACCOUNTS).length} accounts, ${PIPELINE.length} pipeline stages, ${users.length} user(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
