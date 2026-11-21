import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { Empty, PageHeader, Pill, T, td } from "@/components/page";
import { NativeSelect } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NewPartyDialog } from "../party-form";
import { createParty } from "../actions";

export const metadata = { title: "Contacts & companies" };

const FILTERS: Record<string, { label: string; where: Prisma.PartyWhereInput }> = {
  all: { label: "All", where: {} },
  org: { label: "Companies", where: { kind: "ORGANIZATION" } },
  person: { label: "People", where: { kind: "PERSON" } },
  customers: { label: "Customers", where: { isCustomer: true } },
  vendors: { label: "Vendors", where: { isVendor: true } },
  "dukaan-shop": { label: "Dukaan shops", where: { extSource: "DUKAAN", extType: "SHOP" } },
  "dukaan-owner": { label: "Dukaan shop owners", where: { extSource: "DUKAAN", extType: "SHOP_OWNER" } },
  "dukaan-dealer": { label: "Dukaan dealers", where: { extSource: "DUKAAN", extType: "DEALER" } },
  "dukaan-rider": { label: "Dukaan riders", where: { extSource: "DUKAAN", extType: "RIDER" } },
  "dukaan-customer": { label: "Dukaan customers", where: { extSource: "DUKAAN", extType: "CUSTOMER" } },
};

const PAGE = 50;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; page?: string; archived?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const filter = FILTERS[sp.f ?? "all"] ?? FILTERS.all;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim();
  const where: Prisma.PartyWhereInput = {
    ...filter.where,
    archived: sp.archived === "1" ? undefined : false,
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { gstin: { contains: q.toUpperCase() } }, { tags: { has: q.toLowerCase() } }] }
      : {}),
  };
  const [rows, total, orgs] = await Promise.all([
    db.party.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * PAGE, take: PAGE, include: { org: { select: { name: true } }, _count: { select: { deals: true } } } }),
    db.party.count({ where }),
    db.party.findMany({ where: { kind: "ORGANIZATION", archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.f ? { f: sp.f } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader title="Contacts & companies" description={`${total} records · includes shops, owners, dealers, riders and customers synced from Dukaan Express`} actions={can(user.role, "crm.write") && <NewPartyDialog action={createParty} orgs={orgs} />} />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name, email, phone, GSTIN, tag" className="max-w-xs" />
        <NativeSelect name="f" defaultValue={sp.f ?? "all"} className="w-48">
          {Object.entries(FILTERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} /> Include inactive
        </label>
        <Button variant="outline" type="submit">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <Empty>No contacts match. Add one, or sync Dukaan Express from the Dukaan sync page.</Empty>
      ) : (
        <T head={["Name", "Type", "Phone", "Email", "GSTIN", "Tags"]}>
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-muted/30">
              <td className={td}>
                <Link href={`/crm/contacts/${p.id}`} className="font-medium text-primary hover:underline">
                  {p.name}
                </Link>
                {p.org && <div className="text-xs text-muted-foreground">{p.org.name}</div>}
              </td>
              <td className={td}>
                <div className="flex flex-wrap gap-1">
                  <Pill>{p.kind === "PERSON" ? "Person" : "Company"}</Pill>
                  {p.extType && <Pill tone="blue">Dukaan {p.extType.toLowerCase().replace("_", " ")}</Pill>}
                  {p.archived && <Pill tone="red">Inactive</Pill>}
                </div>
              </td>
              <td className={td}>{p.phone ?? "—"}</td>
              <td className={td}>{p.email ?? "—"}</td>
              <td className={td}>{p.gstin ?? "—"}</td>
              <td className={td}>
                <div className="flex flex-wrap gap-1">
                  {p.tags.filter((t) => !t.startsWith("dukaan")).map((t) => (
                    <Pill key={t}>{t}</Pill>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </T>
      )}
      {total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {Math.ceil(total / PAGE)}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={qs(page - 1)}>Previous</Link>
              </Button>
            )}
            {page * PAGE < total && (
              <Button variant="outline" size="sm" asChild>
                <Link href={qs(page + 1)}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
