// Route-handler helpers: auth (defense in depth), same-origin check, rate limit, envelopes, errors.
import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { FinanceError, connectDB, ensureSetup, plain } from "@finance/core";
import { SESSION_COOKIE, verifySession } from "./session";

const g = globalThis as unknown as { __setup?: Promise<void>; __rl?: Map<string, { n: number; reset: number }> };

export async function db() {
  await connectDB();
  g.__setup ??= ensureSetup().catch((e) => {
    g.__setup = undefined;
    throw e;
  });
  await g.__setup;
}

export function rateLimit(key: string, limit: number, windowMs: number) {
  const m = (g.__rl ??= new Map());
  const now = Date.now();
  const h = m.get(key);
  if (!h || h.reset < now) {
    m.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  return ++h.n <= limit;
}

export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";

export const ok = (data: unknown, status = 200) => NextResponse.json({ ok: true, data: plain(data) }, { status });
export const err = (message: string, status = 400, details?: unknown) => NextResponse.json({ ok: false, error: { message, details } }, { status });

type Ctx = { params: Promise<Record<string, string>> };

export function route(fn: (req: Request, params: Record<string, string>) => Promise<Response>, opts: { public?: boolean } = {}) {
  return async (req: Request, ctx: Ctx) => {
    try {
      if (!opts.public) {
        if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) return err("Unauthorized", 401);
        if (req.method !== "GET") {
          // CSRF: mutations must come from our own origin.
          const origin = req.headers.get("origin");
          const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
          if (!origin || new URL(origin).host !== host) return err("Bad origin", 403);
        }
        if (!rateLimit(`api:${clientIp(req)}`, 300, 60_000)) return err("Too many requests", 429);
      }
      await db();
      return await fn(req, (await ctx?.params) ?? {});
    } catch (e) {
      if (e instanceof ZodError) return err("Validation failed", 400, e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      if (e instanceof FinanceError) return err(e.message, e.status);
      if (e instanceof SyntaxError) return err("Invalid JSON body", 400);
      console.error(JSON.stringify({ level: "error", service: "web", msg: "api_error", path: new URL(req.url).pathname, error: String(e) }));
      return err("Internal error", 500);
    }
  };
}

export const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
