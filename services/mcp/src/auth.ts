import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time bearer token check (hashing first equalises lengths). */
export function checkBearer(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || !header?.startsWith("Bearer ")) return false;
  const a = createHash("sha256").update(header.slice(7).trim()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Fixed-window limiter per key; enough for a single-user server. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()) => {
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    return ++h.n <= limit;
  };
}
