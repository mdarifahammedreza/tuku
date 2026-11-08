import { z } from "zod";
import { budgetInput, budgetStatus, dhakaParts, listBudgets, setBudget } from "@finance/core";
import { ok, query, route } from "@/lib/api";

const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), month: z.coerce.number().int().min(1).max(12).optional() });

export const GET = route(async (req) => {
  const now = dhakaParts(new Date());
  const { year = now.year, month = now.month } = q.parse(query(req));
  const [status, history] = await Promise.all([budgetStatus(year, month), listBudgets()]);
  return ok({ year, month, status, history: history.slice(0, 120) });
});
export const POST = route(async (req) => ok(await setBudget(budgetInput.parse(await req.json()), "web"), 201));
