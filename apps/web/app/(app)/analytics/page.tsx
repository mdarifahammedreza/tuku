import { categoryLabel, cn, formatBDT } from "@/lib/utils";
import { db } from "@/lib/api";
import { getAnalytics } from "@/lib/analytics";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { CategoryCompare, CategoryDonut, DailyLine, IncomeExpenseBars, SavingsTrend } from "@/components/charts";

export const dynamic = "force-dynamic";

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-muted">no data last month</span>;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const good = invert ? pct <= 0 : pct >= 0;
  return <span className={cn("text-xs font-medium", good ? "text-good" : "text-bad")}>{pct > 0 ? "▲" : pct < 0 ? "▼" : ""} {Math.abs(pct)}% vs last month</span>;
}

export default async function AnalyticsPage() {
  await db();
  const a = await getAnalytics(12);
  const cur = a.current.summary;
  const prev = a.previous.summary;
  return (
    <>
      <PageHeader title="Analytics" description="Computed from your ledger — transfers, savings and loan principal are not counted as spending." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Income", cur: cur.income, prev: prev.income },
          { label: "Expenses", cur: cur.expenses, prev: prev.expenses, invert: true },
          { label: "Net savings", cur: cur.netCashFlow, prev: prev.netCashFlow },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <div className="text-xs text-fg-2">{k.label} this month</div>
            <div className="mt-1.5 text-xl font-semibold tabular-nums">{formatBDT(k.cur)}</div>
            <div className="mt-1"><Delta cur={k.cur} prev={k.prev} invert={k.invert} /></div>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Monthly income vs expenses" description="Last 12 months" /><CardBody><IncomeExpenseBars data={a.monthly} /></CardBody></Card>
        <Card><CardHeader title="Monthly net savings" description="Income minus expenses" /><CardBody><SavingsTrend data={a.monthly} /></CardBody></Card>
        <Card><CardHeader title="Daily expense trend" description="This month" /><CardBody><DailyLine data={a.daily} /></CardBody></Card>
        <Card><CardHeader title="Category-wise spending" description="This month" /><CardBody><CategoryDonut data={a.current.categories} /></CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader title="This month vs last month" description="Top categories" /><CardBody><CategoryCompare current={a.current.categories} previous={a.previous.categories} /></CardBody></Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Top spending categories" description="This month" />
        <CardBody>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-2"><tr><th className="pb-2 font-medium">Category</th><th className="pb-2 text-right font-medium">This month</th><th className="pb-2 text-right font-medium">Last month</th><th className="pb-2 text-right font-medium">Share</th></tr></thead>
            <tbody className="divide-y divide-border">
              {a.current.categories.slice(0, 10).map((c) => (
                <tr key={c.category}>
                  <td className="py-2">{categoryLabel(c.category)}</td>
                  <td className="py-2 text-right tabular-nums">{formatBDT(c.amount)}</td>
                  <td className="py-2 text-right tabular-nums text-fg-2">{formatBDT(a.previous.categories.find((p) => p.category === c.category)?.amount ?? 0)}</td>
                  <td className="py-2 text-right tabular-nums text-fg-2">{c.share}%</td>
                </tr>
              ))}
              {!a.current.categories.length && <tr><td colSpan={4} className="py-6 text-center text-muted">No expenses yet this month</td></tr>}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
