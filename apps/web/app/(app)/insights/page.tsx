import { Sparkles, Target } from "lucide-react";
import { db } from "@/lib/api";
import { getInsights } from "@/lib/insights";
import { categoryLabel, formatBDT } from "@/lib/utils";
import { Card, CardBody, CardHeader, Empty, PageHeader, Progress } from "@/components/ui";
import { GenerateButtons } from "./generate";

export const dynamic = "force-dynamic";

function Analysis({ r, kind }: { r: any; kind: string }) {
  if (!r) return <Empty>No {kind} analysis yet</Empty>;
  return (
    <div>
      <div className="mb-3 text-xs text-muted">Period {r.periodKey.split(":")[1]} · {r.aiSource === "claude-desktop" ? "saved from Claude Desktop" : "generated"} {new Date(r.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" })}</div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{r.aiAnalysis}</div>
    </div>
  );
}

export default async function InsightsPage() {
  await db();
  const d = await getInsights();
  const patterns = d.monthly?.repeatedSmall?.length ? d.monthly.repeatedSmall : (d.weekly?.repeatedSmall ?? []);
  const unusual = d.monthly?.topExpenses ?? d.weekly?.topExpenses ?? [];
  return (
    <>
      <PageHeader title="AI Insights" description="Claude analyses pre-computed totals only — all figures come from the ledger." action={<GenerateButtons enabled={d.aiConfigured} />} />
      {!d.aiConfigured && (
        <p className="mb-4 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-sm text-fg-2">
          No API key needed: in Claude Desktop ask <i>“Analyse my month with get_monthly_report and save it with save_insight”</i>. It appears here and in the Telegram report.
          Set <code>ANTHROPIC_API_KEY</code> instead for automatic weekly/monthly analysis.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" /> Monthly analysis</span>} /><CardBody><Analysis r={d.monthly} kind="monthly" /></CardBody></Card>
        <Card><CardHeader title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" /> Weekly analysis</span>} /><CardBody><Analysis r={d.weekly} kind="weekly" /></CardBody></Card>
        <Card>
          <CardHeader title="Spending patterns" description="Repeated small purchases (≤ ৳500, 3+ times)" />
          <CardBody>
            {patterns.length ? (
              <ul className="divide-y divide-border text-sm">
                {patterns.map((p: any) => (
                  <li key={p.description} className="flex justify-between py-2"><span className="capitalize">{p.description} <span className="text-xs text-muted">× {p.count} · {categoryLabel(p.category)}</span></span><span className="tabular-nums">{formatBDT(p.total)}</span></li>
                ))}
              </ul>
            ) : <Empty>No repeated small expenses found</Empty>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Largest expenses" description="From the latest analysed period" />
          <CardBody>
            {unusual.length ? (
              <ul className="divide-y divide-border text-sm">
                {unusual.map((t: any, i: number) => <li key={i} className="flex justify-between py-2"><span>{t.description} <span className="text-xs text-muted">· {t.date}</span></span><span className="tabular-nums">{formatBDT(t.amount)}</span></li>)}
              </ul>
            ) : <Empty>Nothing yet</Empty>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={<span className="flex items-center gap-1.5"><Target className="h-4 w-4 text-accent" /> Financial goals</span>} description={`This month: savings rate ${d.savings.thisMonth.savingsRate}% · moved to savings ${formatBDT(d.savings.thisMonth.savingsTransfers)}`} />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            {d.savings.emergencyFund.target > 0 && (
              <div>
                <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">Emergency fund</span><span className="tabular-nums text-fg-2">{formatBDT(d.savings.emergencyFund.saved)} / {formatBDT(d.savings.emergencyFund.target)}</span></div>
                <Progress value={d.savings.emergencyFund.progress} tone="good" />
              </div>
            )}
            {d.savings.goals.map((g: any) => (
              <div key={g.id}>
                <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{g.name}</span><span className="tabular-nums text-fg-2">{formatBDT(g.saved)} / {formatBDT(g.target)}</span></div>
                <Progress value={g.progress} tone="good" />
                {g.deadline && <div className="mt-1 text-xs text-muted">by {new Date(g.deadline).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka" })}</div>}
              </div>
            ))}
            {!d.savings.goals.length && !d.savings.emergencyFund.target && <p className="text-sm text-muted">Add goals and an emergency-fund target in Settings.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
