import { createSavingsGoal, goalInput, savingsProgress } from "@finance/core";
import { ok, route } from "@/lib/api";

export const GET = route(async () => ok(await savingsProgress()));
export const POST = route(async (req) => ok(await createSavingsGoal(goalInput.parse(await req.json()), "web"), 201));
