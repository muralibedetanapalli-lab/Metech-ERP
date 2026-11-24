"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  CalendarCheck,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListTree,
  LogOut,
  Menu,
  Receipt,
  RefreshCw,
  Settings,
  Target,
  UserRound,
  Users,
  Wallet,
  CalendarClock,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV: { section: string; items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[] }[] = [
  { section: "", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    section: "CRM",
    items: [
      { href: "/crm/contacts", label: "Contacts & companies", icon: Users },
      { href: "/crm/leads", label: "Leads", icon: Target },
      { href: "/crm/deals", label: "Deals pipeline", icon: FolderKanban },
      { href: "/crm/tasks", label: "Tasks & follow-ups", icon: CalendarCheck },
    ],
  },
  {
    section: "Accounting",
    items: [
      { href: "/accounting/invoices?kind=SALES", label: "Sales invoices", icon: FileText },
      { href: "/accounting/invoices?kind=PURCHASE", label: "Purchase bills", icon: Receipt },
      { href: "/accounting/payments", label: "Receipts & payments", icon: HandCoins },
      { href: "/accounting/expenses", label: "Expenses", icon: Wallet },
      { href: "/accounting/bank", label: "Bank reconciliation", icon: Landmark },
      { href: "/accounting/journal", label: "Journal", icon: BookOpen },
      { href: "/accounting/accounts", label: "Chart of accounts", icon: ListTree },
      { href: "/reports", label: "Reports", icon: FileSpreadsheet },
    ],
  },
  {
    section: "ERP",
    items: [
      { href: "/erp/items", label: "Items & inventory", icon: Boxes },
      { href: "/erp/assets", label: "Fixed assets", icon: Building2 },
      { href: "/erp/employees", label: "Employees & payroll", icon: UserRound },
      { href: "/erp/projects", label: "Projects", icon: Briefcase },
      { href: "/erp/renewals", label: "Renewals", icon: CalendarClock },
    ],
  },
  {
    section: "System",
    items: [
      { href: "/integrations/dukaan", label: "Dukaan Express sync", icon: RefreshCw },
      { href: "/settings", label: "Settings & users", icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string) {
  const path = href.split("?")[0];
  return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4 px-3 py-4 text-sm">
      {NAV.map((g) => (
        <div key={g.section || "home"}>
          {g.section && <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">{g.section}</div>}
          {g.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive(pathname, it.href) && it.href.includes("?") === false && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                it.href.includes("?") && isActive(pathname, it.href) && "text-sidebar-accent-foreground",
              )}
            >
              <it.icon className="size-4 shrink-0 opacity-80" />
              {it.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ user, logout, children }: { user: { name: string; role: string }; logout: () => Promise<void>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const brand = (
    <div className="flex items-center gap-2 px-5 pt-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary font-bold text-sidebar-primary-foreground">M</div>
      <div className="leading-tight">
        <div className="font-semibold">Metech ERP</div>
        <div className="text-[11px] text-sidebar-foreground/60">Metech Solutions</div>
      </div>
    </div>
  );
  const footer = (
    <div className="mt-auto border-t border-sidebar-border p-3">
      <div className="px-2 text-sm font-medium">{user.name}</div>
      <div className="px-2 pb-2 text-xs text-sidebar-foreground/60">{user.role}</div>
      <form action={logout}>
        <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <LogOut /> Sign out
        </Button>
      </form>
    </div>
  );
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground lg:flex">
        {brand}
        <Nav />
        {footer}
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-64 flex-col overflow-y-auto border-0 bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {brand}
          <Nav onNavigate={() => setOpen(false)} />
          {footer}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <span className="font-semibold">Metech ERP</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
