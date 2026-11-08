import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Landmark, PiggyBank, TrendingUp } from "lucide-react";
import { getOverview, monthlySeries } from "@finance/core";
import { db } from "@/lib/api";
import { categoryLabel, cn, formatBDT, TYPE_LABEL } from "@/lib/utils";
import { Badge, Card, CardBody, CardHeader, Empty, PageHeader, Progress } from "@/components/ui";
import { CategoryDonut, DailyLine, IncomeExpenseBars } from "@/components/charts";

export const dynamic = "force-dynamic";

function Stat({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: string; icon: any; tone?: "good" | "bad" }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-fg-2">
        {label}
        <Icon className="h-4 w-4 text-muted" />
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone === "bad" && "text-bad")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export default async function Overview() {
  await db();
  const [o, months] = await Promise.all([getOverview(), monthlySeries(6)]);
  const s = o.summary;
  const monthName = new Date(o.period.start.getTime() + 6 * 3600e3).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <PageHeader title="Overview" description={monthName} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total balance" value={formatBDT(o.balances.total)} sub={`${o.balances.accounts.length} accounts`} icon={Landmark} tone={o.balances.total < 0 ? "bad" : undefined} />
        <Stat label="Income this month" value={formatBDT(s.income)} icon={ArrowUpRight} />
        <Stat label="Expenses this month" value={formatBDT(s.expenses)} sub={s.refunds ? `after ${formatBDT(s.refunds)} refunds` : undefined} icon={ArrowDownRight} />
        <Stat label="Net savings" value={formatBDT(s.netCashFlow, { sign: true })} sub={`Savings rate ${s.savingsRate}%`} icon={PiggyBank} tone={s.netCashFlow < 0 ? "bad" : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Income vs expenses" description="Last 6 months" />
          <CardBody><IncomeExpenseBars data={months} /></CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Spending by category" description="This month, net of refunds" />
          <CardBody><CategoryDonut data={o.categories} /></CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Daily spending" description="This month" />
          <CardBody><DailyLine data={o.daily} /></CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Accounts" action={<Link href="/settings" className="text-xs text-accent">Manage</Link>} />
          <CardBody className="space-y-2.5">
            {o.balances.accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-fg-2">{a.name} <span className="text-xs text-muted">· {a.type}</span></span>
                <span className={cn("font-medium tabular-nums", a.balance < 0 && "text-bad")}>{formatBDT(a.balance)}</span>
              </div>
            ))}
            {(o.loans.totalReceivable > 0 || o.loans.totalPayable > 0) && (
              <div className="mt-3 border-t border-border pt-3 text-sm">
                <div className="flex justify-between"><span className="text-fg-2">Others owe you</span><span className="tabular-nums">{formatBDT(o.loans.totalReceivable)}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-fg-2">You owe</span><span className="tabular-nums">{formatBDT(o.loans.totalPayable)}</span></div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recent transactions" action={<Link href="/transactions" className="text-xs text-accent">View all</Link>} />
          <CardBody className="pt-3">
            {o.recent.length ? (
              <ul className="divide-y divide-border">
                {o.recent.map((t) => {
                  const inflow = ["income", "refund", "loan_received"].includes(t.type) || (t.type === "loan_repayment" && t.loanKind === "receivable");
                  return (
                    <li key={t._id.toString()} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.description}</div>
                        <div className="text-xs text-muted">{categoryLabel(t.category)} · {new Date(t.transactionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dhaka" })}</div>
                      </div>
                      {t.type !== "expense" && <Badge>{TYPE_LABEL[t.type]}</Badge>}
                      <span className={cn("text-sm font-medium tabular-nums", inflow && "text-good")}>{inflow ? "+" : ""}{formatBDT(t.amount)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty>Send “alu 30” to your Telegram bot to get started</Empty>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Budget utilization" action={<Link href="/budgets" className="text-xs text-accent">Edit</Link>} />
          <CardBody className="space-y-4">
            {o.budgets.length ? o.budgets.slice(0, 6).map((b) => (
              <div key={b.id}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-fg-2">{b.category === "total" ? "Overall" : categoryLabel(b.category)}</span>
                  <span className="tabular-nums"><span className="font-medium">{formatBDT(b.spent)}</span><span className="text-muted"> / {formatBDT(b.allocated)}</span></span>
                </div>
                <Progress value={b.utilization} tone={b.alert === "over" ? "bad" : b.alert === "warning" ? "warn" : "good"} />
              </div>
            )) : <Empty><span className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> No budgets set for this month</span></Empty>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
