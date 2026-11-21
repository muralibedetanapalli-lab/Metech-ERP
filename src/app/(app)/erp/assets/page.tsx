import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { Empty, Money, PageHeader, Panel, T, fmtDate, td, tdNum } from "@/components/page";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { saveAsset } from "../actions";
import { bookValue } from "@/lib/depreciation";

export const metadata = { title: "Fixed assets" };

export default async function AssetsPage() {
  const user = await requireUser();
  const assets = await db.asset.findMany({ orderBy: { purchaseDate: "desc" } });
  return (
    <>
      <PageHeader title="Fixed assets" description="Asset register with straight-line depreciation. Post depreciation to the books with a manual journal (Dr Depreciation / Cr Accumulated depreciation)." />
      {can(user.role, "erp.write") && (
        <Panel title="Add asset" className="mb-6">
          <ActionForm action={saveAsset} className="grid gap-3 md:grid-cols-4">
            <Field label="Asset code" name="code" required />
            <Field label="Name" name="name" required className="md:col-span-2" />
            <Field label="Category" name="category" required placeholder="Laptop, furniture…" />
            <Field label="Purchase date" name="purchaseDate" type="date" defaultValue={todayIso()} required />
            <Field label="Cost (₹)" name="cost" inputMode="decimal" required />
            <Field label="Useful life (months)" name="usefulLifeMonths" defaultValue="36" />
            <Field label="Salvage value (₹)" name="salvageValue" inputMode="decimal" />
            <Field label="Location" name="location" />
            <Field label="Assigned to" name="assignedTo" />
            <div className="self-end">
              <SubmitButton>Add asset</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
      {assets.length === 0 ? (
        <Empty>No assets yet.</Empty>
      ) : (
        <T head={["Code", "Asset", "Category", "Purchased", "Assigned", <span key="c" className="block text-right">Cost</span>, <span key="d" className="block text-right">Depreciation</span>, <span key="v" className="block text-right">Book value</span>]}>
          {assets.map((a) => {
            const b = bookValue(a);
            return (
              <tr key={a.id}>
                <td className={td}>{a.code}</td>
                <td className={td}>{a.name}</td>
                <td className={td}>{a.category}</td>
                <td className={td}>{fmtDate(a.purchaseDate)}</td>
                <td className={td}>{a.assignedTo ?? "—"}</td>
                <td className={tdNum}>
                  <Money value={a.cost} />
                </td>
                <td className={tdNum}>
                  <Money value={b.depreciation} />
                </td>
                <td className={tdNum}>
                  <Money value={b.value} />
                </td>
              </tr>
            );
          })}
        </T>
      )}
    </>
  );
}
