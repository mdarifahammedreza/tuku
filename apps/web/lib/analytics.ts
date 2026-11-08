import "server-only";
import { categoryTrends, currentMonthPeriod, dailySeries, getSummary, monthlySeries, previousMonthPeriod } from "@finance/core";

export async function getAnalytics(months = 6) {
  const cur = currentMonthPeriod();
  const prev = previousMonthPeriod();
  const [monthly, daily, current, previous, trends] = await Promise.all([
    monthlySeries(months),
    dailySeries(cur),
    getSummary(cur),
    getSummary(prev),
    categoryTrends([prev, cur]),
  ]);
  return { monthly, daily, current, previous, trends };
}
