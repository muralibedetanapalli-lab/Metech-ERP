import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { syncAllProjects } from "@/server/projects/sync";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Scheduled sync of every connected project (Dukaan Express and any project-feed apps):
 * POST with "Authorization: Bearer $CRON_SECRET", e.g. from an Azure Container Apps job.
 * Kept at this path so the existing job keeps working; /api/integrations/sync is the same.
 */
export async function POST(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !timingSafeEqual(digest(token), digest(secret))) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }, { status: 401 });
  }
  const results = await syncAllProjects("CRON");
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ data: { ok, projects: results } }, { status: ok ? 200 : 502 });
}
