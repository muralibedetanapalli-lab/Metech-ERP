"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ActionState } from "@/lib/action-state";

export function NewDealDialog({
  action,
  stages,
  parties,
  label = "New deal",
  leadOnly,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  stages: { id: string; name: string; isLead: boolean }[];
  parties: { id: string; name: string }[];
  label?: string;
  leadOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = stages.filter((s) => !leadOnly || s.isLead);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="grid gap-3">
          <Field label="Title" name="title" required placeholder="e.g. Dukaan onboarding — Sri Sai Kirana" />
          <SelectField label="Existing contact / company" name="partyId" placeholder="— new company below —" options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          <Field label="…or new company name" name="newCompany" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Value (₹)" name="value" inputMode="decimal" placeholder="0" />
            <SelectField label="Stage" name="stageId" options={options.map((s) => ({ value: s.id, label: s.name }))} />
            <Field label="Source" name="source" placeholder="Referral, website…" />
            <Field label="Expected close" name="expectedClose" type="date" />
          </div>
          <SubmitButton>Create</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
