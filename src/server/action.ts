import "server-only";
import { ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import type { ActionState } from "@/lib/action-state";
import { AppError } from "./errors";

/** Readable message for any error thrown inside a server action. */
export function errorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const i = err.issues[0];
    return i ? `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "Invalid input";
  }
  if (err instanceof AppError) return err.message;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return "A record with these details already exists";
    if (err.code === "P2025") return "Record not found";
    if (err.code === "P2003") return "This record is in use and cannot be removed";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

/**
 * Run a mutation for a form action: returns { ok, message } or { error } instead of throwing,
 * and revalidates the given paths on success. Redirects thrown by `redirect()` pass through.
 */
export async function run(fn: () => Promise<string | void>, paths: string[] = []): Promise<ActionState> {
  try {
    const message = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: message || "Saved", at: Date.now() };
  } catch (err) {
    unstable_rethrow(err);
    if (!(err instanceof AppError) && !(err instanceof ZodError)) console.error("[action]", err);
    return { error: errorMessage(err), at: Date.now() };
  }
}

/** FormData helpers. */
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
export const req = (fd: FormData, k: string, label = k) => {
  const v = str(fd, k);
  if (!v) throw new AppError(400, "REQUIRED", `${label} is required`);
  return v;
};
