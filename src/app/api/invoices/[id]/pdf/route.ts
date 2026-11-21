import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { invoicePdf } from "@/server/accounting/invoice-pdf";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return NextResponse.json({ error: { message: "Sign in" } }, { status: 401 });
  const { id } = await ctx.params;
  const { bytes, filename } = await invoicePdf(id);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"` } });
}
