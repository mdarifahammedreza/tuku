import "server-only";
import { Report, savingsProgress } from "@finance/core";

export async function getInsights() {
  const [weekly, monthly, savings] = await Promise.all([
    Report.findOne({ reportType: "weekly", aiAnalysis: { $nin: [null, ""] } }).sort({ periodStart: -1, generatedAt: -1 }).lean(),
    Report.findOne({ reportType: "monthly", aiAnalysis: { $nin: [null, ""] } }).sort({ periodStart: -1, generatedAt: -1 }).lean(),
    savingsProgress(),
  ]);
  const pick = (r: any) => r && { periodKey: r.periodKey, generatedAt: r.generatedAt, aiAnalysis: r.aiAnalysis, aiSource: r.aiSource, totalIncome: r.totalIncome, totalExpenses: r.totalExpenses, repeatedSmall: r.data?.repeatedSmall ?? [], topExpenses: r.data?.topExpenses ?? [] };
  return { weekly: pick(weekly), monthly: pick(monthly), savings, aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY) };
}
