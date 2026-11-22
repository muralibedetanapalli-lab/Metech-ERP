# Metech project feed, v1

How a project app (TentOs, or any other business line) connects to Metech ERP so its customers, vendors, invoices, bills, payments and expenses land in Metech's books, tagged with the project. Dukaan Express predates this and uses its own feed; new apps use this one.

Metech ERP **pulls**: the app only has to expose two read-only endpoints. The validating code is `src/server/projects/feed-contract.ts`.

## Connecting

1. In the app, generate a random service key (32+ characters) and protect the two endpoints below with it.
2. In Metech ERP, go to **Projects**, add the project (for example code `TENTOS`), open it and fill in **App connection**:
   - **Connection:** Metech project feed v1.
   - **Feed URL:** must use HTTPS (plain http is allowed for localhost only).
   - **API key:** stored encrypted with `SECRETS_KEY`.
   - **Bank account:** the one that the app's payments and expenses go through.
3. Click **Test connection**, then **Sync now**. With **Include in scheduled sync** ticked, the 6-hourly job syncs it too.

## Endpoints

```
GET {feedUrl}/parties?limit=1..500&after=<cursor>
GET {feedUrl}/events?limit=1..500&after=<cursor>
Authorization: Bearer <service key>

200 → { "data": { "items": [...], "nextCursor": "<opaque>" | null, "hasMore": true | false } }
401 → wrong key        (any non-2xx stops the run; the next run retries)
```

- **Order:** return items oldest change first. `nextCursor` is any opaque string the app can resume from; Metech stores it after each page and sends it back as `after`.
- **Parties:** return a party again whenever it changes.
- **Events:** append-only. Each event `id` must be unique and must never change. Metech applies an id once and ignores repeats, so re-reading the feed is safe.
- **Errors:** an event Metech cannot apply stops the run at that event, and the error is shown on the project page. Fix the data in the app, and the next run continues from there. This way a payment is never booked before its invoice.

**Units:**
- Money is integer **paise** (₹1,180.50 = `118050`).
- GST rates are **basis points** (18% = `1800`).
- Dates are `YYYY-MM-DD` (the Indian calendar day) or ISO timestamps.
- State codes are 2-digit GST codes (`36` = Telangana).

## Parties

```json
{ "id": "cus_81", "roles": ["CUSTOMER"], "kind": "ORGANIZATION", "name": "Sri Events", "gstin": "36AABCM1234F1ZY",
  "stateCode": "36", "email": "ops@srievents.in", "phone": "+919800000000", "address": "…", "city": "Hyderabad", "pincode": "500081", "active": true }
```

- `roles` is `CUSTOMER` and/or `VENDOR`.
- `kind` is `PERSON` or `ORGANIZATION`. It defaults to `ORGANIZATION` when a GSTIN is given.
- The state comes from `stateCode`, otherwise from the GSTIN, otherwise from `state` (a state name).
- Parties become CRM contacts tagged with the project code. Notes and tags added in the CRM are kept.

## Events

Every event has `{ "id", "type", "occurredAt", "data" }`. The document date is `data.date`, or `occurredAt` if it's missing.

Document lines (`lines`, at least one):

```json
{ "description": "Tent hire — 3 days", "hsnSac": "997319", "quantity": 1, "rate": 2500000, "discount": 0, "taxRateBps": 1800, "accountCode": "4000" }
```

`accountCode` is optional:
- Sales lines default to *Sales*. Any income account code is allowed.
- Purchase lines default to *Purchases*. Any expense or asset account code is allowed.

| `type` | `data` | Booked in Metech as |
| --- | --- | --- |
| `sale.invoice` | `number`, `customerId`, `date?`, `dueDate?`, `placeOfSupply?`, `lines`, `notes?` | Sales invoice **with the app's number**: the app issues the GST invoice under Metech's GSTIN, so it appears in GSTR-1. Place of supply defaults to the customer's state. Use a series of its own (e.g. `TOS/26-27/0001`). |
| `sale.credit_note` / `sale.debit_note` | `number`, `customerId`, `invoiceNumber?`, `reason`, `date?`, `placeOfSupply?`, `lines` | Credit / debit note with the app's number. A credit note is set off against `invoiceNumber`. |
| `sale.cancelled` | `number`, `reason?` | Voids that invoice or note (it must have no payments). |
| `purchase.bill` | `vendorId`, `billNumber`, `date?`, `dueDate?`, `lines`, `notes?` | Purchase bill. Metech gives it a `PB/…` number, and `billNumber` is kept as the vendor's reference. |
| `purchase.credit_note` / `purchase.debit_note` | `vendorId`, `noteNumber`, `billNumber?`, `reason`, `date?`, `lines` | Vendor credit / debit note against that bill. |
| `purchase.cancelled` | `vendorId`, `billNumber`, `reason?` | Voids that bill. |
| `payment.received` | `customerId`, `amount`, `date?`, `mode?`, `reference?`, `allocations: [{ invoiceNumber, amount }]` | Receipt into the project's bank account, settling those invoices. Any amount not allocated stays as an advance. |
| `payment.made` | `vendorId`, `amount`, `date?`, `mode?`, `reference?`, `allocations: [{ billNumber, amount }]` | Payment from the project's bank account. |
| `expense` | `amount` (before GST), `gstRateBps?`, `interState?`, `description`, `accountCode?`, `vendorId?`, `reference?`, `date?` | Expense paid from the project's bank account, with input GST. Defaults to *Miscellaneous expenses*. |

All of these are tagged with the project, so they show up in its revenue and direct cost. If an event refers to a customer or vendor the parties feed hasn't sent yet, Metech creates a placeholder, and it is filled in when the party arrives.

## How project cost is worked out

**Reports → Project costing** and the **Projects** page show, for any period:

- **Revenue** and **direct cost** come from everything tagged with the project: synced documents, invoices and expenses entered with the project chosen, and Dukaan postings.
- **Shared costs** are expenses not tagged to any project (salaries, rent, software and so on), plus the costs of departments and branches. They are split across projects in proportion to their revenue, so a project with 70% of the revenue carries 70% of the shared costs.
- **Overall cost** is direct cost plus the share of shared costs. **Profit** is revenue minus overall cost.
