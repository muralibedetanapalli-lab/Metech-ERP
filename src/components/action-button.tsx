"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";

const ICONS = { sync: RefreshCw, test: PlugZap };

/** A button that runs a (bound) server action and shows its result as a toast. */
export function ActionButton({ action, label, icon = "sync", variant = "default", disabled }: { action: () => Promise<ActionState>; label: string; icon?: keyof typeof ICONS; variant?: "default" | "outline"; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const Icon = ICONS[icon];
  return (
    <Button
      variant={variant}
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r.error) toast.error(r.error);
          else toast.success(r.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Icon />} {label}
    </Button>
  );
}
