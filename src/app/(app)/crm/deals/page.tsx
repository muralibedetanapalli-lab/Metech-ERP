import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { Money, PageHeader, fmtDate } from "@/components/page";
import { NativeSelect } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { NewDealDialog } from "../deal-form";
import { createDeal, moveDeal } from "../actions";

export const metadata = { title: "Deals pipeline" };

export default async function DealsPage() {
  const user = await requireUser();
  const [stages, deals, parties] = await Promise.all([
    db.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
    db.deal.findMany({ include: { party: { select: { id: true, name: true } }, owner: { select: { name: true } } }, orderBy: { updatedAt: "desc" } }),
    db.party.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 }),
  ]);
  const writable = can(user.role, "crm.write");
  const open = deals.filter((d) => stages.find((s) => s.id === d.stageId)?.outcome === "OPEN");
  return (
    <>
      <PageHeader
        title="Deals pipeline"
        description={
          <>
            {open.length} open deals worth <Money value={open.reduce((s, d) => s + d.value, 0)} />
          </>
        }
        actions={writable && <NewDealDialog action={createDeal} stages={stages} parties={parties} />}
      />
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((s) => {
          const list = deals.filter((d) => d.stageId === s.id);
          return (
            <div key={s.id} className="w-72 shrink-0 rounded-xl bg-muted/50 p-2">
              <div className="mb-2 flex items-center justify-between px-1 text-sm">
                <span className="font-semibold">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {list.length} · <Money value={list.reduce((a, d) => a + d.value, 0)} compact />
                </span>
              </div>
              <div className="grid gap-2">
                {list.map((d) => (
                  <div key={d.id} className="rounded-lg border bg-card p-3 text-sm shadow-xs">
                    <div className="font-medium">{d.title}</div>
                    {d.party && (
                      <Link href={`/crm/contacts/${d.party.id}`} className="text-xs text-primary hover:underline">
                        {d.party.name}
                      </Link>
                    )}
                    <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                      <Money value={d.value} />
                      <span>{d.expectedClose ? `close ${fmtDate(d.expectedClose)}` : d.owner?.name}</span>
                    </div>
                    {writable && (
                      <form action={moveDeal} className="mt-2 flex gap-1">
                        <input type="hidden" name="id" value={d.id} />
                        <NativeSelect name="stageId" defaultValue={d.stageId} className="h-7 text-xs">
                          {stages.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name}
                            </option>
                          ))}
                        </NativeSelect>
                        <Button size="xs" variant="outline" type="submit">
                          Move
                        </Button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
