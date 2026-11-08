import { z } from "zod";
import { Budget, FinanceError, objectId, setBudget } from "@finance/core";
import { ok, route } from "@/lib/api";

const body = z.object({ allocatedAmount: z.number().min(0).max(1_000_000_000).multipleOf(0.01) });

export const PATCH = route(async (req, p) => {
  const b = await Budget.findById(objectId.parse(p.id)).lean();
  if (!b) throw new FinanceError("Budget not found", 404);
  const { allocatedAmount } = body.parse(await req.json());
  return ok(await setBudget({ year: b.year, month: b.month, category: b.category, allocatedAmount }, "web"));
});
