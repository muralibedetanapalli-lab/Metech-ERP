import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/jwt";

/**
 * Next.js 16 "proxy" (formerly middleware): a fast first check on the signed session cookie.
 * Every page and server action re-validates the user against the database.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (!session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)$).*)"],
};
