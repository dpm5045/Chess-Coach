/**
 * Minimal in-memory sliding-window rate limiter. Per-instance only — good
 * enough for a personal deployment; swap for Upstash Ratelimit if this app
 * ever runs multi-instance.
 */
const hits = new Map<string, number[]>();

export function allowRequest(
  key: string,
  limit = 10,
  windowMs = 60_000,
  now = Date.now()
): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
