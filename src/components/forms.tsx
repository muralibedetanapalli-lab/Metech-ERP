"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { initialState, type ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A <form> bound to a server action: shows a toast with the result and optionally resets on success. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  onSuccess,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const ref = useRef<HTMLFormElement>(null);
  const success = useRef(onSuccess);
  useEffect(() => {
    success.current = onSuccess;
  });
  useEffect(() => {
    if (!state.at) return;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(state.message ?? "Saved");
      if (resetOnSuccess) ref.current?.reset();
      success.current?.();
    }
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
    </form>
  );
}

export function SubmitButton({ children, className, variant, size }: { children: React.ReactNode; className?: string; variant?: "default" | "outline" | "destructive" | "secondary" | "ghost"; size?: "default" | "sm" | "xs" | "lg" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant} size={size}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

export function Field({
  label,
  name,
  className,
  hint,
  ...props
}: { label: string; name: string; hint?: string } & React.ComponentProps<"input">) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Native select styled like the inputs (works inside server-action forms without client state). */
export function SelectField({
  label,
  name,
  options,
  className,
  placeholder,
  ...props
}: {
  label?: string;
  name: string;
  options: { value: string; label: string }[];
  placeholder?: string;
} & React.ComponentProps<"select">) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && <Label htmlFor={name}>{label}</Label>}
      <NativeSelect id={name} name={name} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TextareaField({ label, name, className, ...props }: { label: string; name: string } & React.ComponentProps<"textarea">) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        {...props}
      />
    </div>
  );
}
