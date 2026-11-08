import { z } from "zod";
import { Report } from "@finance/core";
import { ok, query, route } from "@/lib/api";

const q = z.object({ type: z.enum(["daily", "weekly", "monthly"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

export const GET = route(async (req) => {
  const { type, limit } = q.parse(query(req));
  return ok(await Report.find(type ? { reportType: type } : {}).select("-data").sort({ periodStart: -1 }).limit(limit).lean());
});
