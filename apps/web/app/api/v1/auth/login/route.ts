import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { clientIp, err, ok, rateLimit, route } from "@/lib/api";
import { SESSION_COOKIE, cookieOptions, createSession } from "@/lib/session";

const body = z.object({ password: z.string().min(1).max(200) });
const digest = (s: string) => createHash("sha256").update(s).digest();

export const POST = route(async (req) => {
  if (!rateLimit(`login:${clientIp(req)}`, 5, 60_000)) return err("Too many attempts. Wait a minute.", 429);
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || expected.length < 10) return err("DASHBOARD_PASSWORD is not configured (min 10 chars)", 500);
  const { password } = body.parse(await req.json());
  if (!timingSafeEqual(digest(password), digest(expected))) {
    console.warn(JSON.stringify({ level: "warn", service: "web", msg: "login_failed", ip: clientIp(req) }));
    return err("Wrong password", 401);
  }
  (await cookies()).set(SESSION_COOKIE, await createSession(), cookieOptions);
  return ok({ loggedIn: true });
}, { public: true });
