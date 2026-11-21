"use client";

import { useActionState } from "react";
import { Field, SubmitButton } from "@/components/forms";
import { initialState } from "@/lib/action-state";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, initialState);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </form>
  );
}
