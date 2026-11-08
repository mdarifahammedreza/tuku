import { z } from "zod";
import { buildMonthly, dhakaParts, monthPeriod } from "@finance/core";
import { ok, query, route } from "@/lib/api";

const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), month: z.coerce.number().int().min(1).max(12).optional() });

export const GET = route(async (req) => {
  const now = dhakaParts(new Date());
  const { year = now.year, month = now.month } = q.parse(query(req));
  return ok(await buildMonthly(monthPeriod(year, month)));
});
