import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { Empty, PageHeader, Panel, Pill, fmtDate } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ActivityForm } from "../activity-form";
import { addActivity, toggleActivity } from "../actions";

export const metadata = { title: "Tasks & follow-ups" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ mine?: string; done?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [tasks, users, parties] = await Promise.all([
    db.activity.findMany({
      where: { dueAt: { not: null }, doneAt: sp.done === "1" ? { not: null } : null, ...(sp.mine === "1" ? { assigneeId: user.id } : {}) },
      include: { party: { select: { id: true, name: true } }, deal: { select: { title: true } }, assignee: { select: { name: true } } },
      orderBy: { dueAt: sp.done === "1" ? "desc" : "asc" },
      take: 200,
    }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
    db.party.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 }),
  ]);
  const now = new Date();
  const endOfToday = new Date(now.getTime() + 86_400_000);
  const groups = [
    { label: "Overdue", items: tasks.filter((t) => !t.doneAt && t.dueAt! < now) },
    { label: "Due today", items: tasks.filter((t) => !t.doneAt && t.dueAt! >= now && t.dueAt! < endOfToday) },
    { label: "Upcoming", items: tasks.filter((t) => !t.doneAt && t.dueAt! >= endOfToday) },
    { label: "Completed", items: tasks.filter((t) => t.doneAt) },
  ].filter((g) => g.items.length);
  const writable = can(user.role, "crm.write");
  return (
    <>
      <PageHeader
        title="Tasks & follow-ups"
        description="Reminders for calls, meetings and follow-ups across contacts and deals"
        actions={
          <>
            <Button variant={sp.mine === "1" ? "default" : "outline"} size="sm" asChild>
              <Link href={sp.mine === "1" ? "/crm/tasks" : "/crm/tasks?mine=1"}>Only mine</Link>
            </Button>
            <Button variant={sp.done === "1" ? "default" : "outline"} size="sm" asChild>
              <Link href={sp.done === "1" ? "/crm/tasks" : "/crm/tasks?done=1"}>Completed</Link>
            </Button>
          </>
        }
      />
      {writable && (
        <Panel title="New task or reminder" className="mb-4">
          <ActivityForm action={addActivity} users={users} parties={parties} compact />
        </Panel>
      )}
      {groups.length === 0 && <Empty>No tasks here.</Empty>}
      <div className="grid gap-4">
        {groups.map((g) => (
          <Panel key={g.label} title={`${g.label} (${g.items.length})`}>
            <ul className="divide-y text-sm">
              {g.items.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className={t.doneAt ? "line-through opacity-60" : "font-medium"}>{t.subject}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.type.replace("_", " ").toLowerCase()}
                      {t.party && (
                        <>
                          {" · "}
                          <Link href={`/crm/contacts/${t.party.id}`} className="hover:underline">
                            {t.party.name}
                          </Link>
                        </>
                      )}
                      {t.deal && ` · ${t.deal.title}`}
                      {t.assignee && ` · ${t.assignee.name}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Pill tone={t.doneAt ? "green" : t.dueAt! < now ? "red" : "amber"}>{fmtDate(t.dueAt)}</Pill>
                    {writable && (
                      <form action={toggleActivity}>
                        <input type="hidden" name="id" value={t.id} />
                        <Button size="xs" variant="outline" type="submit">
                          {t.doneAt ? "Reopen" : "Done"}
                        </Button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
