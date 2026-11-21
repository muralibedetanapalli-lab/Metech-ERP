import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { accountSums, naturalBalance } from "@/server/accounting/reports";
import { can } from "@/lib/permissions";
import { Money, PageHeader, Panel, Pill, T, td, tdNum } from "@/components/page";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { createAccount, toggleAccount } from "../actions";
import { db } from "@/server/db";

export const metadata = { title: "Chart of accounts" };

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export default async function AccountsPage() {
  const user = await requireUser();
  const [sums, all] = await Promise.all([accountSums({}), db.account.findMany({ select: { id: true, active: true, systemKey: true } })]);
  const meta = new Map(all.map((a) => [a.id, a]));
  const writable = can(user.role, "accounting.write");
  return (
    <>
      <PageHeader title="Chart of accounts" description="Balances include all posted entries. System accounts are used by automatic postings and cannot be disabled." />
      {writable && (
        <Panel title="Add account" className="mb-6">
          <ActionForm action={createAccount} className="grid gap-3 md:grid-cols-5">
            <Field label="Code" name="code" required placeholder="e.g. 1020" />
            <Field label="Name" name="name" required className="md:col-span-2" placeholder="e.g. HDFC current a/c" />
            <SelectField label="Type" name="type" options={TYPES.map((t) => ({ value: t, label: t.toLowerCase() }))} />
            <SelectField label="Subtype" name="subtype" placeholder="—" options={["BANK", "CASH", "RECEIVABLE", "PAYABLE", "TAX", "INVENTORY", "FIXED_ASSET", "CLEARING"].map((s) => ({ value: s, label: s.toLowerCase().replace("_", " ") }))} />
            <div className="md:col-span-5">
              <SubmitButton>Add account</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
      <div className="grid gap-6">
        {TYPES.map((t) => {
          const rows = sums.filter((a) => a.type === t);
          return (
            <div key={t}>
              <h2 className="mb-2 text-sm font-semibold capitalize">{t.toLowerCase()}</h2>
              <T head={["Code", "Account", "Subtype", <span key="b" className="block text-right">Balance</span>, ""]}>
                {rows.map((a) => {
                  const m = meta.get(a.id);
                  return (
                    <tr key={a.id} className={m?.active ? "" : "opacity-50"}>
                      <td className={td}>{a.code}</td>
                      <td className={td}>
                        <Link href={`/accounting/ledger?accountId=${a.id}`} className="text-primary hover:underline">
                          {a.name}
                        </Link>{" "}
                        {m?.systemKey && <Pill>system</Pill>}
                      </td>
                      <td className={td}>{a.subtype?.toLowerCase().replace("_", " ") ?? ""}</td>
                      <td className={tdNum}>
                        <Money value={naturalBalance(a)} />
                      </td>
                      <td className={td}>
                        {writable && !m?.systemKey && (
                          <form action={toggleAccount}>
                            <input type="hidden" name="id" value={a.id} />
                            <Button size="xs" variant="ghost" type="submit">
                              {m?.active ? "Disable" : "Enable"}
                            </Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </T>
            </div>
          );
        })}
      </div>
    </>
  );
}
