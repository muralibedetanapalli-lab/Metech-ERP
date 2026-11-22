import "server-only";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { dukaanConfigured, runDukaanSync } from "@/server/dukaan/sync";
import { runFeedSync } from "./feed-sync";

export type Trigger = "MANUAL" | "CRON" | "CLI" | "TEST";

export interface ProjectSyncResult {
  projectId: string;
  code: string;
  ok: boolean;
  parties: number;
  events: number;
  posted: number;
  skipped: number;
  error?: string;
}

/** Whether a project can be synced right now (connector set up). */
export function projectConfigured(p: { connector: string | null; baseUrl: string | null; apiKeyEnc: string | null }) {
  if (p.connector === "DUKAAN") return dukaanConfigured();
  if (p.connector === "FEED_V1") return Boolean(p.baseUrl && p.apiKeyEnc);
  return false;
}

export async function syncProject(projectId: string, trigger: Trigger): Promise<ProjectSyncResult> {
  const p = await db.costCentre.findUniqueOrThrow({ where: { id: projectId } });
  if (!projectConfigured(p)) throw new AppError(400, "NOT_CONFIGURED", `${p.name} has no working connection yet`);
  const r = p.connector === "DUKAAN" ? await runDukaanSync(trigger) : await runFeedSync(p.id, trigger);
  return { projectId: p.id, code: p.code, ok: r.ok, parties: r.parties, events: r.events, posted: r.posted, skipped: r.skipped, error: r.error };
}

/** Scheduled sync: every active project with a connector and sync switched on. One failure does not stop the others. */
export async function syncAllProjects(trigger: Trigger) {
  const projects = await db.costCentre.findMany({ where: { active: true, syncEnabled: true, connector: { not: null } }, orderBy: { code: "asc" } });
  const results: ProjectSyncResult[] = [];
  for (const p of projects) {
    if (!projectConfigured(p)) continue;
    try {
      results.push(await syncProject(p.id, trigger));
    } catch (err) {
      results.push({ projectId: p.id, code: p.code, ok: false, parties: 0, events: 0, posted: 0, skipped: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
