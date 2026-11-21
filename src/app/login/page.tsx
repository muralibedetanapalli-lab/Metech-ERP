import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <div className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">M</div>
          <h1 className="text-xl font-semibold">Metech ERP</h1>
          <p className="text-sm text-muted-foreground">Accounting, ERP and CRM for Metech Solutions</p>
        </div>
        <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/"} />
      </div>
    </main>
  );
}
