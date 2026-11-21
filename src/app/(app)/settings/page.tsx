import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can, ROLE_LABEL, ROLES } from "@/lib/permissions";
import { GST_STATES } from "@/lib/gst";
import { PageHeader, Panel, Pill, T, fmtDate, td } from "@/components/page";
import { ActionForm, Field, NativeSelect, SelectField, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { changeOwnPassword, createUser, saveCompany, updateUser } from "./actions";

export const metadata = { title: "Settings & users" };

export default async function SettingsPage() {
  const user = await requireUser();
  const admin = can(user.role, "admin");
  const [company, users] = await Promise.all([db.companySettings.upsert({ where: { id: "company" }, create: {}, update: {} }), admin ? db.user.findMany({ orderBy: { createdAt: "asc" } }) : []]);
  const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  return (
    <>
      <PageHeader title="Settings & users" />
      <div className="grid gap-6">
        {admin && (
          <Panel title="Company profile (printed on invoices)">
            <ActionForm action={saveCompany} resetOnSuccess={false} className="grid gap-3 md:grid-cols-3">
              <Field label="Name" name="name" defaultValue={company.name} required />
              <Field label="Legal name" name="legalName" defaultValue={company.legalName ?? ""} />
              <Field label="GSTIN" name="gstin" defaultValue={company.gstin ?? ""} />
              <Field label="PAN" name="pan" defaultValue={company.pan ?? ""} />
              <SelectField label="State (GST)" name="stateCode" defaultValue={company.stateCode} options={Object.entries(GST_STATES).sort(([a], [b]) => a.localeCompare(b)).map(([v, l]) => ({ value: v, label: `${v} · ${l}` }))} />
              <Field label="Invoice number prefix" name="invoicePrefix" defaultValue={company.invoicePrefix} />
              <Field label="Address" name="address" defaultValue={company.address ?? ""} className="md:col-span-3" />
              <Field label="Email" name="email" defaultValue={company.email ?? ""} />
              <Field label="Phone" name="phone" defaultValue={company.phone ?? ""} />
              <div className="self-end">
                <SubmitButton>Save</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        )}
        {admin && (
          <Panel title="Users & roles">
            <p className="mb-3 text-sm text-muted-foreground">
              Owner: everything. Accountant: accounting, ERP and Dukaan sync. Sales: CRM. Viewer: read-only. Changing a role, deactivating or resetting a password signs the user out everywhere.
            </p>
            <T head={["User", "Role", "Active", "Reset password", "Last login", ""]}>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className={td}>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className={td} colSpan={4}>
                    <ActionForm action={updateUser} resetOnSuccess={false} className="grid grid-cols-[160px_60px_1fr_120px_auto] items-center gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <NativeSelect name="role" defaultValue={u.role}>
                        {roleOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                      <input type="checkbox" name="active" defaultChecked={u.active} aria-label="Active" />
                      <Input name="password" type="password" placeholder="New password (optional)" autoComplete="new-password" />
                      <span className="text-xs text-muted-foreground">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "never"}</span>
                      <SubmitButton size="sm" variant="outline">
                        Update
                      </SubmitButton>
                    </ActionForm>
                  </td>
                  <td className={td}>{u.id === user.id && <Pill>you</Pill>}</td>
                </tr>
              ))}
            </T>
            <ActionForm action={createUser} className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-5">
              <Field label="Name" name="name" required />
              <Field label="Email" name="email" type="email" required />
              <SelectField label="Role" name="role" defaultValue="VIEWER" options={roleOptions} />
              <Field label="Password" name="password" type="password" required autoComplete="new-password" />
              <div className="self-end">
                <SubmitButton>Add user</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        )}
        <Panel title="Change your password">
          <ActionForm action={changeOwnPassword} className="grid max-w-xl gap-3 md:grid-cols-3">
            <Field label="Current" name="current" type="password" required autoComplete="current-password" />
            <Field label="New" name="next" type="password" required autoComplete="new-password" />
            <div className="self-end">
              <SubmitButton>Change</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
