"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";

export function SyncButton({ action, disabled }: { action: () => Promise<ActionState>; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r.error) toast.error(r.error);
          else toast.success(r.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
    </Button>
  );
}
