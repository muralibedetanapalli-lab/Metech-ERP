import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { GST_RATES_BPS } from "@/lib/gst";
import { Empty, Money, PageHeader, Panel, Pill, T, td, tdNum } from "@/components/page";
import { ActionForm, Field, NativeSelect, SelectField, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { adjustStock, saveItem } from "../actions";

export const metadata = { title: "Items & inventory" };

export default async function ItemsPage() {
  const user = await requireUser();
  const writable = can(user.role, "erp.write");
  const items = await db.item.findMany({ orderBy: { name: "asc" } });
  const stockValue = items.reduce((s, i) => s + (i.trackStock ? Math.round(i.stock * i.purchasePrice) : 0), 0);
  return (
    <>
      <PageHeader title="Items & inventory" description={<>Goods and services used on invoices. Purchase bills add stock, sales invoices reduce it. Stock value at cost: <Money value={stockValue} /></>} />
      {writable && (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <Panel title="New item" className="lg:col-span-2">
            <ActionForm action={saveItem} className="grid gap-3 sm:grid-cols-4">
              <Field label="SKU" name="sku" required />
              <Field label="Name" name="name" required className="sm:col-span-2" />
              <SelectField label="Type" name="kind" options={[{ value: "GOODS", label: "Goods (stocked)" }, { value: "SERVICE", label: "Service" }]} />
              <Field label="HSN / SAC" name="hsnSac" />
              <Field label="Unit" name="unit" defaultValue="nos" />
              <Field label="Sale price (₹)" name="salePrice" inputMode="decimal" />
              <Field label="Purchase price (₹)" name="purchasePrice" inputMode="decimal" />
              <SelectField label="GST" name="taxRateBps" defaultValue="1800" options={GST_RATES_BPS.map((r) => ({ value: String(r), label: `${r / 100}%` }))} />
              <Field label="Opening stock" name="openingStock" inputMode="decimal" />
              <Field label="Reorder level" name="reorderLevel" inputMode="decimal" />
              <div className="self-end">
                <SubmitButton>Add item</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
          <Panel title="Stock adjustment">
            <ActionForm action={adjustStock} className="grid gap-3">
              <NativeSelect name="itemId" required>
                {items.filter((i) => i.trackStock).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
              <Input name="quantity" inputMode="decimal" placeholder="+10 or -2" required />
              <Input name="reference" placeholder="Reason / reference" />
              <SubmitButton variant="outline">Adjust</SubmitButton>
            </ActionForm>
          </Panel>
        </div>
      )}
      {items.length === 0 ? (
        <Empty>No items yet.</Empty>
      ) : (
        <T head={["SKU", "Name", "HSN/SAC", "GST", <span key="s" className="block text-right">Sale</span>, <span key="p" className="block text-right">Cost</span>, <span key="q" className="block text-right">Stock</span>]}>
          {items.map((i) => (
            <tr key={i.id}>
              <td className={td}>{i.sku}</td>
              <td className={td}>
                {i.name} {i.kind === "SERVICE" && <Pill>service</Pill>}
              </td>
              <td className={td}>{i.hsnSac ?? "—"}</td>
              <td className={td}>{i.taxRateBps / 100}%</td>
              <td className={tdNum}>
                <Money value={i.salePrice} />
              </td>
              <td className={tdNum}>
                <Money value={i.purchasePrice} />
              </td>
              <td className={tdNum}>
                {i.trackStock ? (
                  <span className={i.stock <= i.reorderLevel ? "font-semibold text-destructive" : ""}>
                    {i.stock} {i.unit}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </T>
      )}
    </>
  );
}
