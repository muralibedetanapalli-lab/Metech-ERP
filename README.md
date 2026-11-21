# Metech ERP

Accounting, ERP and CRM for **Metech Solutions**, the company that runs **Dukaan Express**. It keeps Metech's own books and customer records, and it pulls Dukaan's shops, owners, dealers, riders and customers, plus its orders and payouts, so the marketplace shows up in Metech's books automatically.

Stack (same as Dukaan Express): Next.js 16 (App Router, server actions, `proxy.ts`), Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Tailwind 4 with shadcn/ui (Radix), zod, exceljs and pdf-lib for exports, and vitest.

> This Next.js version differs from older releases: request APIs (`params`, `searchParams`, `cookies()`) are async, and middleware is now `src/proxy.ts`. Read `node_modules/next/dist/docs/` before changing framework-level code.

## Modules

| Area | Screens |
| --- | --- |
| **CRM** | Contacts & companies (one `Party` table shared with accounting), leads, a deals pipeline (Kanban by stage), and activities: notes, calls, meetings, tasks and follow-up reminders with due dates. The dashboard shows tasks that are due. |
| **Accounting** | Chart of accounts; a double-entry journal (manual, opening balances, void); GST sales invoices and purchase bills (CGST+SGST or IGST from the place of supply, with GSTIN validation, HSN/SAC and PDF invoices); receipts and payments allocated to invoices; expenses with input GST; bank reconciliation (CSV import, match or book); and account and party ledgers. |
| **Reports** | Trial balance, profit & loss, balance sheet, GST summary, receivables and payables with ageing, and ledgers. Each one exports to Excel and PDF. |
| **ERP** | Items and stock (purchases add stock, sales remove it, plus adjustments); a fixed-asset register with straight-line depreciation; employees and basic payroll (PF 12% of basic up to ₹15,000 and Telangana professional tax, posted to the books); and projects and cost centres showing income, cost and margin. |
| **Dukaan sync** | Sync status, "Sync now", posting settings and run history. |
| **Settings** | Company profile (printed on invoices) and users and roles. |

All money is stored as integer **paise**, and rates are stored in basis points. Every document posts a balanced journal entry, and every report reads only journal lines, so the trial balance always balances.

### Roles

| Role | Can change |
| --- | --- |
| Owner | Everything, including users and settings |
| Accountant | Accounting, ERP, Dukaan sync |
| Sales | CRM |
| Viewer | Nothing (read-only) |

Every signed-in user can read every module. When an owner changes a user's role, deactivates them or resets their password, that user is signed out everywhere: the session version is bumped.

## Local setup

The app needs Node 22 or later and PostgreSQL. On this machine, the Dukaan dev cluster on port **5433** is used (trust auth, user `postgres`).

```bash
cd D:\Personal\Metech-ERP
npm install
copy .env.example .env      # then fill JWT_SECRET, DUKAAN_API_KEY, CRON_SECRET (random 48-byte strings)
```

Create the databases once:

```bash
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -p 5433 -U postgres -c "create database metech_erp" -c "create database metech_erp_test"
```

Then apply the migrations, seed, and start the server:

```bash
npx prisma migrate deploy
npm run db:seed
npm run dev                 # http://localhost:3100
```

The seed creates the company, the chart of accounts (47 accounts, including the Dukaan ones), the pipeline stages, and three development users. Their emails and password are listed at the top of `prisma/seed.ts`. In production, set `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` instead.

```bash
npm test          # unit + integration tests (uses TEST_DATABASE_URL)
npm run typecheck
npm run lint
npm run build
```

## Dukaan Express integration

```
 Dukaan Express (Next.js, Azure)                       Metech ERP
 ───────────────────────────────                       ──────────
 GET /api/v1/integrations/erp/parties  ◄── pull ──  runDukaanSync()  → CRM parties (upsert)
 GET /api/v1/integrations/erp/events   ◄── pull ──                   → journal entries (once each)
     Authorization: Bearer ERP_API_KEY                 DUKAAN_API_KEY (same value)

 Admin shop / order / customer pages
   "Metech ERP" button ───────────────────────────►  /link/dukaan/{shop|order|customer|owner|dealer|rider}/{id}
 ERP contact & journal pages
   "Open in Dukaan admin" ◄─────────────────────────  DUKAAN_BASE_URL + /admin/…
```

**Security.** The integration runs server to server only. Dukaan exposes two read-only feeds, protected by a scoped service key: `ERP_API_KEY` on the Dukaan side and `DUKAAN_API_KEY` here. The key is compared in constant time and the feeds are rate-limited. When the key is unset, the feeds are disabled (HTTP 503). The feeds never include bank account numbers, KYC documents or passwords. Use HTTPS in production.

**Feeds.** Both feeds are cursor-paged: `?after=<cursor>&limit=<1..500>` returns `{ data: { items, nextCursor, hasMore } }`. The cursor is opaque and stores a (timestamp, id) position for each source, and the ERP saves it after every page.

- `parties` returns shops, shop owners, dealers, riders and customers. They become CRM organisations and contacts tagged `dukaan-*`, linked to the Dukaan id, with each owner linked to their shop. CRM notes and tags you add are kept; name, phone and email stay owned by Dukaan.
- `events` returns these money events:

| Event | Journal entry in Metech's books |
| --- | --- |
| `order.delivered` (from the Commission row written at delivery) | **Dr** Cashfree clearing (online), or **Dr** rider wallet (COD collected by a Dukaan rider), or nothing (COD where the shop delivers, already netted in the shop's earning). **Cr** payable to shop (`shopEarning`), **Cr** rider wallet (`riderFee`), **Cr** platform commission (optionally less 18% output GST). The remainder goes to delivery income (**Cr**) or delivery cost (**Dr**). The dealer's share is **Dr** dealer commission expense and **Cr** dealer payable. |
| `shop_settlement.paid` | **Dr** payable to shop, **Cr** payout bank |
| `dealer_payout.paid` | **Dr** dealer payable, **Cr** payout bank |
| `rider_withdrawal.paid` | **Dr** rider wallet, **Cr** payout bank |
| `rider_wallet.adjustment` | **Dr** or **Cr** rider wallet against delivery cost |
| `refund.processed` (delivered orders only) | **Dr** refunds expense, **Cr** Cashfree clearing. A refund on an order that was never delivered has no effect, because its collection was never booked. |

Metech acts as an agent: shop sales are not Metech's revenue, but commission and delivery margin are. Revenue is recognised when an order is delivered. Each event posts once, keyed by `sourceRef = dukaan:<event id>`, so re-running the sync (or using "Re-read from start") never creates duplicates. When Cashfree settlements reach the bank, reconcile them against **Cashfree clearing** on the bank reconciliation page.

**Running a sync:**

- Click "Sync now" on **Dukaan Express sync** (Owner or Accountant).
- Run `npm run sync:dukaan` from the CLI.
- Schedule it with `POST /api/integrations/dukaan/sync` and `Authorization: Bearer $CRON_SECRET`, for example from an Azure Container Apps job every 15 minutes.

**Settings.** On the Dukaan sync page you can choose the bank account that pays Dukaan payouts and whether commission includes 18% GST.

### Changes needed on the Dukaan side

The Dukaan change is small and separate, and lives in the Dukaan repo:

- `src/server/services/erp-feed.ts`: the two feeds.
- `src/app/api/v1/integrations/erp/[feed]/route.ts`: the key check and rate limit.
- `src/components/admin/erp-link.tsx`, plus one line each in the admin shop, order and customer pages: the "Metech ERP" button, shown only when `ERP_URL` is set.
- The `ERP_API_KEY` and `ERP_URL` entries in `.env.example` and in the OpenAPI list.
- `tests/integration/erp-feed.test.ts`.

To connect the two apps locally:

1. Generate one random key.
2. Put it in Dukaan's `.env` as `ERP_API_KEY`, and in Metech ERP's `.env` as `DUKAAN_API_KEY`.
3. Set `ERP_URL=http://localhost:3100` in Dukaan, and `DUKAAN_BASE_URL=http://localhost:3000` here (use whatever port Dukaan's dev server runs on).
4. Restart both apps and click "Sync now".

## Deploying (planned: same Azure account as Dukaan)

The `Dockerfile` follows Dukaan's: a standalone Next.js server, and `prisma migrate deploy` on start-up (`RUN_MIGRATIONS=false` turns it off). The suggested setup is a new Container App plus a new database on Dukaan's existing Azure Postgres server, with these secrets: `DATABASE_URL`, `JWT_SECRET`, `DUKAAN_BASE_URL`, `DUKAAN_API_KEY` and `CRON_SECRET`. Dukaan's Container App then gets `ERP_API_KEY` and `ERP_URL`. Nothing has been created in Azure yet; that needs approval first.

## Project layout

```
prisma/schema.prisma           data model (parties, CRM, ledger, documents, ERP, sync state)
prisma/seed.ts                 company, chart of accounts, pipeline, dev users
src/proxy.ts                   session check for pages
src/server/accounting/         chart of accounts, posting engine, documents, reports, bank CSV, invoice PDF
src/server/dukaan/             feed contract, pure event→journal mapping, sync runner
src/server/erp/payroll.ts      payslips + payroll journal
src/app/(app)/…                screens (server components + server actions)
src/app/api/…                  report/PDF exports, cron sync, health
src/app/(app)/link/dukaan/…    deep links from the Dukaan admin
tests/unit, tests/integration  vitest (integration tests use TEST_DATABASE_URL)
```

## Not built yet (next milestones)

- Webhooks from Dukaan, for near-real-time sync instead of polling.
- Pulling Cashfree settlement reports for automatic clearing-to-bank entries.
- E-invoicing (IRN) and GSTR-1 JSON export.
- TDS on vendor payments.
- Credit and debit notes.
- Automatic depreciation postings.
- Fuller payroll: TDS, ESI, payslip PDFs.
- Email reminders for follow-ups.
- Audit log screen.
