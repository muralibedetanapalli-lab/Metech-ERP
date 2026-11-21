"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { clearSessionCookie, createSessionCookie } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import type { ActionState } from "@/lib/action-state";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = String(fd.get("next") ?? "/");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`login:${ip}`, 10, 60_000).ok || !rateLimit(`login:${email}`, 10, 15 * 60_000).ok) {
    return { error: "Too many attempts. Try again in a few minutes.", at: Date.now() };
  }
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Wrong email or password", at: Date.now() };
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSessionCookie(user);
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
