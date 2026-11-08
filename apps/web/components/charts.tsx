"use client";
// Recharts with the validated categorical palette (CSS vars swap per theme); thin marks, recessive grid, tooltips.
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { categoryLabel, compactBDT, formatBDT, SERIES } from "@/lib/utils";
import { Empty } from "./ui";

const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Tip({ active, payload, label, labelFormat }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <div className="mb-1 font-medium text-fg">{labelFormat ? labelFormat(label) : label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2 text-fg-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-medium text-fg tabular-nums">{formatBDT(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-fg-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  );
}

const shortDay = (d: string) => String(Number(d.slice(8)));
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" });

export function IncomeExpenseBars({ data }: { data: { month: string; income: number; expenses: number }[] }) {
  if (!data.some((d) => d.income || d.expenses)) return <Empty>No data yet</Empty>;
  return (
    <div>
      <Legend items={[{ label: "Income", color: SERIES[0] }, { label: "Expenses", color: SERIES[1] }]} />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="month" tickFormatter={monthName} {...axis} />
          <YAxis tickFormatter={compactBDT} width={48} {...axis} />
          <Tooltip content={<Tip labelFormat={monthName} />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="income" name="Income" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expenses" name="Expenses" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyLine({ data, height = 220 }: { data: { date: string; expenses: number }[]; height?: number }) {
  if (!data.some((d) => d.expenses)) return <Empty>No spending recorded this month</Empty>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="date" tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={16} {...axis} />
        <YAxis tickFormatter={compactBDT} width={48} {...axis} />
        <Tooltip content={<Tip labelFormat={(d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} />} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} />
        <Line type="monotone" dataKey="expenses" name="Spent" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Donut of the top 6 categories + "Other", with a value list as the direct labels. */
export function CategoryDonut({ data }: { data: { category: string; amount: number; share: number }[] }) {
  const positive = data.filter((d) => d.amount > 0);
  if (!positive.length) return <Empty>No expenses yet</Empty>;
  const top = positive.slice(0, 6);
  const rest = positive.slice(6).reduce((t, d) => t + d.amount, 0);
  const total = positive.reduce((t, d) => t + d.amount, 0);
  const rows = [...top.map((d, i) => ({ name: categoryLabel(d.category), value: d.amount, fill: SERIES[i] })), ...(rest ? [{ name: "Other", value: rest, fill: "var(--series-other)" }] : [])];
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.name} fill={r.fill} />)}
            </Pie>
            <Tooltip content={<Tip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted">Total</span>
          <span className="text-sm font-semibold tabular-nums">{formatBDT(total)}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.fill }} />
            <span className="truncate text-fg-2">{r.name}</span>
            <span className="ml-auto font-medium tabular-nums">{formatBDT(r.value)}</span>
            <span className="w-11 text-right text-xs text-muted tabular-nums">{Math.round((r.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SavingsTrend({ data }: { data: { month: string; net: number }[] }) {
  if (!data.some((d) => d.net)) return <Empty>No data yet</Empty>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="month" tickFormatter={monthName} {...axis} />
        <YAxis tickFormatter={compactBDT} width={48} {...axis} />
        <Tooltip content={<Tip labelFormat={monthName} />} cursor={{ fill: "var(--surface-2)" }} />
        <Bar dataKey="net" name="Net savings" radius={[4, 4, 0, 0]} maxBarSize={28}>
          {data.map((d) => <Cell key={d.month} fill={d.net >= 0 ? SERIES[2] : "var(--bad)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryCompare({ current, previous }: { current: { category: string; amount: number }[]; previous: { category: string; amount: number }[] }) {
  const cats = [...new Set([...current, ...previous].filter((c) => c.amount > 0).map((c) => c.category))];
  const data = cats
    .map((c) => ({ name: categoryLabel(c), current: current.find((x) => x.category === c)?.amount ?? 0, previous: previous.find((x) => x.category === c)?.amount ?? 0 }))
    .sort((a, b) => b.current - a.current)
    .slice(0, 8);
  if (!data.length) return <Empty>No expenses in either month</Empty>;
  return (
    <div>
      <Legend items={[{ label: "This month", color: SERIES[0] }, { label: "Last month", color: "var(--series-other)" }]} />
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 40)}>
        <BarChart data={data} layout="vertical" barGap={2} margin={{ left: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={compactBDT} {...axis} />
          <YAxis type="category" dataKey="name" width={110} {...axis} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="current" name="This month" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={12} />
          <Bar dataKey="previous" name="Last month" fill="var(--series-other)" radius={[0, 4, 4, 0]} maxBarSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
