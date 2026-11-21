"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { GST_STATES } from "@/lib/gst";
import type { ActionState } from "@/lib/action-state";

export interface PartyDefaults {
  id?: string;
  kind?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  isCustomer?: boolean;
  isVendor?: boolean;
  orgId?: string | null;
  tags?: string[];
  notes?: string | null;
  synced?: boolean;
}

const STATES = Object.entries(GST_STATES).sort(([a], [b]) => a.localeCompare(b)).map(([value, label]) => ({ value, label: `${value} · ${label}` }));

export function PartyFields({ d = {}, orgs }: { d?: PartyDefaults; orgs: { id: string; name: string }[] }) {
  const [kind, setKind] = useState(d.kind ?? "ORGANIZATION");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <SelectField label="Type" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "ORGANIZATION", label: "Company / organisation" }, { value: "PERSON", label: "Contact person" }]} />
      <Field label={kind === "PERSON" ? "Full name" : "Company name"} name="name" defaultValue={d.name} required readOnly={d.synced} />
      <Field label="Email" name="email" type="email" defaultValue={d.email ?? ""} readOnly={d.synced} />
      <Field label="Phone" name="phone" defaultValue={d.phone ?? ""} readOnly={d.synced} />
      {kind === "PERSON" && <SelectField label="Works at" name="orgId" defaultValue={d.orgId ?? ""} placeholder="—" options={orgs.map((o) => ({ value: o.id, label: o.name }))} />}
      <Field label="GSTIN" name="gstin" defaultValue={d.gstin ?? ""} placeholder="36ABCDE1234F1Z5" />
      <Field label="PAN" name="pan" defaultValue={d.pan ?? ""} />
      <SelectField label="State (GST)" name="stateCode" defaultValue={d.stateCode ?? "36"} options={STATES} />
      <Field label="Address" name="address" defaultValue={d.address ?? ""} className="sm:col-span-2" />
      <Field label="City" name="city" defaultValue={d.city ?? ""} />
      <Field label="Pincode" name="pincode" defaultValue={d.pincode ?? ""} />
      <Field label="Tags (comma separated)" name="tags" defaultValue={d.tags?.join(", ") ?? ""} className="sm:col-span-2" />
      <div className="flex gap-4 text-sm sm:col-span-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isCustomer" defaultChecked={d.isCustomer} /> Customer
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isVendor" defaultChecked={d.isVendor} /> Vendor / supplier
        </label>
      </div>
      <TextareaField label="Notes" name="notes" defaultValue={d.notes ?? ""} className="sm:col-span-2" />
      {d.synced && <p className="text-xs text-muted-foreground sm:col-span-2">Name, email and phone come from Dukaan Express and update on every sync.</p>}
    </div>
  );
}

export function NewPartyDialog({ action, orgs, defaults }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; orgs: { id: string; name: string }[]; defaults?: PartyDefaults }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New contact
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New contact or company</DialogTitle>
        </DialogHeader>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="grid gap-4">
          <input type="hidden" name="open" value="1" />
          <PartyFields d={defaults} orgs={orgs} />
          <SubmitButton>Create</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function EditPartyForm({ action, orgs, d }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; orgs: { id: string; name: string }[]; d: PartyDefaults }) {
  return (
    <ActionForm action={action} resetOnSuccess={false} className="grid gap-4">
      <PartyFields d={d} orgs={orgs} />
      <div>
        <SubmitButton>Save changes</SubmitButton>
      </div>
    </ActionForm>
  );
}
