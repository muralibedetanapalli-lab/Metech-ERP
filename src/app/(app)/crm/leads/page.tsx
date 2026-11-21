import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { Empty, Money, PageHeader, Pill, T, fmtDate, td, tdNum } from "@/components/page";
import { NativeSelect } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { NewDealDialog } from "../deal-form";
import { createDeal, moveDeal } from "../actions";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const user = await requireUser();
  const [stages, leads, parties] = await Promise.all([
    db.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
    db.deal.findMany({
      where: { stage: { isLead: true } },
      include: { stage: true, party: { select: { id: true, name: true, phone: true } }, activities: { where: { doneAt: null, dueAt: { not: null } }, orderBy: { dueAt: "asc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
    }),
    db.party.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 }),
  ]);
  const writable = can(user.role, "crm.write");
  return (
    <>
      <PageHeader title="Leads" description="New and contacted prospects. Qualify a lead to move it into the deals pipeline." actions={writable && <NewDealDialog action={createDeal} stages={stages} parties={parties} label="New lead" leadOnly />} />
      {leads.length === 0 ? (
        <Empty>No open leads.</Empty>
      ) : (
        <T head={["Lead", "Contact", "Stage", "Next follow-up", "Source", <span key="v" className="block text-right">Value</span>, ""]}>
          {leads.map((d) => (
            <tr key={d.id}>
              <td className={td}>{d.title}</td>
              <td className={td}>
                {d.party ? (
                  <Link className="text-primary hover:underline" href={`/crm/contacts/${d.party.id}`}>
                    {d.party.name}
                  </Link>
                ) : (
                  "—"
                )}
                {d.party?.phone && <div className="text-xs text-muted-foreground">{d.party.phone}</div>}
              </td>
              <td className={td}>
                <Pill>{d.stage.name}</Pill>
              </td>
              <td className={td}>{d.activities[0] ? `${fmtDate(d.activities[0].dueAt)} · ${d.activities[0].subject}` : <span className="text-muted-foreground">none</span>}</td>
              <td className={td}>{d.source ?? "—"}</td>
              <td className={tdNum}>
                <Money value={d.value} />
              </td>
              <td className={td}>
                {writable && (
                  <form action={moveDeal} className="flex gap-1">
                    <input type="hidden" name="id" value={d.id} />
                    <NativeSelect name="stageId" defaultValue={d.stageId} className="h-7 w-36 text-xs">
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
              </td>
            </tr>
          ))}
        </T>
      )}
    </>
  );
}
