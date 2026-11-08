"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, CircleCheck, OctagonAlert } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Empty, Input, Label, PageHeader, Progress, Select } from "@/components/ui";
import { api, CATEGORIES, categoryLabel, formatBDT } from "@/lib/utils";

type Row = { id: string; category: string; allocated: number; spent: number; remaining: number; utilization: number; alert: "ok" | "warning" | "over" };
type Data = { year: number; month: number; status: { rows: Row[] }; history: { id: string; year: number; month: number; category: string; allocatedAmount: number }[] };

const EXPENSE_CATS = CATEGORIES.filter((c) => c.kind === "expense");
const label = (c: string) => (c === "total" ? "Overall monthly budget" : categoryLabel(c));

export default function BudgetsPage() {
  const now = new Date(Date.now() + 6 * 3600e3);
  const [ym, setYm] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ category: "total", amount: "" });
  const [error, setError] = useState("");

  const load = useCallback(() => api<Data>(`/api/v1/budgets?year=${ym.year}&month=${ym.month}`).then(setData).catch((e) => setError(e.message)), [ym]);
  useEffect(() => { load(); }, [load]);

  const shift = (d: number) => setYm(({ year, month }) => {
    const m = month + d;
    return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/budgets", { method: "POST", body: JSON.stringify({ ...ym, category: form.category, allocatedAmount: Number(form.amount) }) });
      setForm((f) => ({ ...f, amount: "" }));
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copyPrevious() {
    const prev = ym.month === 1 ? { year: ym.year - 1, month: 12 } : { year: ym.year, month: ym.month - 1 };
    const rows = data?.history.filter((h) => h.year === prev.year && h.month === prev.month) ?? [];
    if (!rows.length) return setError("No budgets in the previous month to copy.");
    for (const r of rows) await api("/api/v1/budgets", { method: "POST", body: JSON.stringify({ ...ym, category: r.category, allocatedAmount: r.allocatedAmount / 100 }) });
    load();
  }

  const title = new Date(Date.UTC(ym.year, ym.month - 1, 1)).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  const rows = data?.status.rows ?? [];
  const alerts = rows.filter((r) => r.alert !== "ok");
  const historyMonths = [...new Set((data?.history ?? []).map((h) => `${h.year}-${String(h.month).padStart(2, "0")}`))].slice(0, 6);

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Spending is net of refunds. Alerts at 80% and 100%."
        action={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="w-36 text-center text-sm font-medium">{title}</span>
            <Button variant="outline" size="sm" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      {alerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${a.alert === "over" ? "border-bad/30 bg-bad/8 text-bad" : "border-warn/30 bg-warn/8 text-warn"}`}>
              {a.alert === "over" ? <OctagonAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <span><b>{label(a.category)}</b> {a.alert === "over" ? `is over budget by ${formatBDT(-a.remaining)}` : `has used ${a.utilization}% — ${formatBDT(a.remaining)} left`}</span>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Used vs allocated" action={<Button size="sm" variant="ghost" onClick={copyPrevious}>Copy last month</Button>} />
          <CardBody className="space-y-5">
            {rows.length ? rows.map((r) => (
              <div key={r.id}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    {r.alert === "ok" ? <CircleCheck className="h-3.5 w-3.5 text-good" /> : r.alert === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-warn" /> : <OctagonAlert className="h-3.5 w-3.5 text-bad" />}
                    {label(r.category)}
                  </span>
                  <span className="tabular-nums text-fg-2"><b className="text-fg">{formatBDT(r.spent)}</b> of {formatBDT(r.allocated)} · {r.remaining >= 0 ? `${formatBDT(r.remaining)} left` : `${formatBDT(-r.remaining)} over`}</span>
                </div>
                <Progress value={r.utilization} tone={r.alert === "over" ? "bad" : r.alert === "warning" ? "warn" : "good"} />
              </div>
            )) : <Empty>No budgets for {title}</Empty>}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Set a budget" description={title} />
            <CardBody>
              <form onSubmit={save} className="space-y-3">
                <div><Label>Category</Label><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="total">Overall monthly budget</option>{EXPENSE_CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
                <div><Label>Amount (৳)</Label><Input inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g. 30000" /></div>
                {error && <p className="text-sm text-bad">{error}</p>}
                <Button className="w-full">Save budget</Button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Budget history" />
            <CardBody className="space-y-2 text-sm">
              {historyMonths.length ? historyMonths.map((m) => {
                const items = data!.history.filter((h) => `${h.year}-${String(h.month).padStart(2, "0")}` === m);
                const total = items.find((i) => i.category === "total");
                return (
                  <div key={m} className="flex justify-between">
                    <span className="text-fg-2">{m}</span>
                    <span className="tabular-nums">{total ? formatBDT(total.allocatedAmount) : `${items.length} categories`}</span>
                  </div>
                );
              }) : <p className="text-muted">No history yet</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
