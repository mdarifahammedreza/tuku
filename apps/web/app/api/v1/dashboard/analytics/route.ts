import { z } from "zod";
import { ok, query, route } from "@/lib/api";
import { getAnalytics } from "@/lib/analytics";

export const GET = route(async (req) => {
  const { months } = z.object({ months: z.coerce.number().int().min(2).max(24).default(6) }).parse(query(req));
  return ok(await getAnalytics(months));
});
