import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { can, type Permission } from "@/lib/permissions";
import { SESSION_COOKIE, signSession, verifySession, type Role } from "./jwt";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Current user from the session cookie, re-validated against the database (active flag, session version). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await db.user.findUnique({ where: { id: claims.sub } });
  if (!user || !user.active || user.sessionVersion !== claims.sv || user.role !== claims.role) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

/** For server components and server actions: redirect to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions that change data. */
export async function requirePermission(perm: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, perm)) throw new Error("Your role does not allow this change.");
  return user;
}

export async function createSessionCookie(user: { id: string; role: Role; sessionVersion: number }) {
  const ttl = env().SESSION_TTL_HOURS;
  const token = await signSession({ sub: user.id, role: user.role, sv: user.sessionVersion }, ttl);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttl * 3600,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
