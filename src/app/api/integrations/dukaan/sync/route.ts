import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { dukaanConfigured, runDukaanSync } from "@/server/dukaan/sync";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Scheduled sync: POST with "Authorization: Bearer $CRON_SECRET" (e.g. from an Azure Container Apps job every 15 minutes). */
export async function POST(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !timingSafeEqual(digest(token), digest(secret))) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }, { status: 401 });
  }
  if (!dukaanConfigured()) return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "Dukaan integration is not configured" } }, { status: 503 });
  try {
    const r = await runDukaanSync("CRON");
    return NextResponse.json({ data: r }, { status: r.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ error: { code: "BUSY", message: err instanceof Error ? err.message : "Sync failed" } }, { status: 409 });
  }
}
