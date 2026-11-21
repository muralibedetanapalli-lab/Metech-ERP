"use client";

import { useState } from "react";
import { ActionForm, Field, NativeSelect, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/action-state";

const TYPES = [
  { value: "NOTE", label: "Note" },
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "EMAIL", label: "Email" },
  { value: "TASK", label: "Task" },
  { value: "FOLLOW_UP", label: "Follow-up reminder" },
];

/** Log a note/call/meeting, or create a task / follow-up with a due date. */
export function ActivityForm({
  action,
  partyId,
  dealId,
  users,
  parties,
  compact,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  partyId?: string;
  dealId?: string;
  users: { id: string; name: string }[];
  parties?: { id: string; name: string }[];
  compact?: boolean;
}) {
  const [type, setType] = useState("NOTE");
  const needsDue = type === "TASK" || type === "FOLLOW_UP";
  return (
    <ActionForm action={action} className="grid gap-2">
      {partyId && <input type="hidden" name="partyId" value={partyId} />}
      {dealId && <input type="hidden" name="dealId" value={dealId} />}
      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <NativeSelect name="type" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
        <Input name="subject" placeholder={needsDue ? "What needs doing?" : "Subject"} required={needsDue} />
      </div>
      {!compact && <textarea name="body" placeholder="Details" className="min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm" />}
      <div className="grid gap-2 sm:grid-cols-3">
        {parties && (
          <NativeSelect name="partyId" defaultValue="">
            <option value="">No contact</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {(needsDue || type !== "NOTE") && <Field label="" name="dueAt" type="datetime-local" required={needsDue} aria-label="Due" />}
        {needsDue && (
          <NativeSelect name="assigneeId" defaultValue="">
            <option value="">Assign to me</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      <div>
        <SubmitButton size="sm">{needsDue ? "Add reminder" : "Log"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
