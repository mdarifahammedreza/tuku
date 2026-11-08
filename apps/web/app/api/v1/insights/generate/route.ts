import { z } from "zod";
import { aiEnabled, currentMonthPeriod, generateReport, last7DaysPeriod, previousMonthPeriod } from "@finance/core";
import { err, ok, rateLimit, route } from "@/lib/api";

const body = z.object({ type: z.enum(["weekly", "monthly", "last_month"]) });
export const maxDuration = 180;

export const POST = route(async (req) => {
  if (!aiEnabled()) return err("ANTHROPIC_API_KEY is not configured", 503);
  if (!rateLimit("insights", 10, 3600_000)) return err("Generation limit reached (10/hour)", 429);
  const { type } = body.parse(await req.json());
  const r = type === "weekly" ? await generateReport("weekly", last7DaysPeriod()) : await generateReport("monthly", type === "monthly" ? currentMonthPeriod() : previousMonthPeriod());
  if (!r.report?.aiAnalysis) return err(r.report?.aiError ?? "Analysis failed", 502);
  return ok({ periodKey: r.report.periodKey, aiAnalysis: r.report.aiAnalysis, generatedAt: r.report.generatedAt });
});
