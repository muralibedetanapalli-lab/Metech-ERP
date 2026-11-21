import "server-only";

/** In-memory fixed-window limiter (per app instance). Good enough for login throttling. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  b.count++;
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  return { ok: b.count <= limit };
}
