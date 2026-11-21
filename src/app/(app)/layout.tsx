import { requireUser } from "@/server/auth/session";
import { ROLE_LABEL } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell user={{ name: user.name, role: ROLE_LABEL[user.role] }} logout={logoutAction}>
      {children}
    </AppShell>
  );
}
