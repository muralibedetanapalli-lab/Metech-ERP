import "server-only";
import { z } from "zod";

const blank = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().default("http://localhost:3100"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  DUKAAN_BASE_URL: blank,
  DUKAAN_API_KEY: blank,
  CRON_SECRET: blank,
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment configuration — ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that change process.env between cases. */
export function resetEnvCache() {
  cached = undefined;
}
