import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { gstr1ForMonth } from "@/server/accounting/gstr1";

/** GET /api/gstr1?month=YYYY-MM → GSTR-1 JSON for upload on the GST portal. */
export async function GET(req: Request) {
  if (!(await getSessionUser())) return NextResponse.json({ error: { message: "Sign in" } }, { status: 401 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: { message: "month must be YYYY-MM" } }, { status: 400 });
  const { json } = await gstr1ForMonth(month);
  const fp = String(json.fp);
  return new Response(JSON.stringify(json, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="GSTR1_${json.gstin || "NO-GSTIN"}_${fp}.json"` },
  });
}
