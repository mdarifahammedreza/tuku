// Report building (deterministic), Telegram formatting, and idempotent delivery.
import { createHash } from "node:crypto";
import { Report } from "./models";
import { formatBDT, toTaka } from "./money";
import { categoryLabel } from "./categories";
import { addDays, dayKey, dayPeriod, dhakaHour, dhakaParts, last7DaysPeriod, monthPeriod, precedingPeriod, previousMonthPeriod, type Period } from "./dates";
import { percentChange } from "./ledger";
import { analyze, aiEnabled, describeAIError } from "./advisor";
import { budgetStatus, getBalances, getLoanSummary, getProfile, getSummary, repeatedSmallExpenses, savingsProgress, topExpenses } from "./service";

export type ReportType = "daily" | "weekly" | "monthly";

// ---------- data ----------
export async function buildDaily(period: Period) {
  const [{ summary }, balances] = await Promise.all([getSummary(period), getBalances()]);
  return { period: period.label, todayIncome: summary.income, todayExpenses: summary.expenses, balances };
}

export async function buildWeekly(period: Period) {
  const prev = precedingPeriod(period);
  const [cur, before, balances, top, repeated] = await Promise.all([getSummary(period), getSummary(prev), getBalances(), topExpenses(period, 5), repeatedSmallExpenses(period)]);
  return {
    period: period.label,
    summary: cur.summary,
    categories: cur.categories,
    previous: { period: prev.label, summary: before.summary },
    expenseChange: percentChange(cur.summary.expenses, before.summary.expenses),
    balance: balances.total,
    topExpenses: top.map((t) => ({ description: t.description, amount: t.amount, category: t.category, date: dayKey(t.transactionDate) })),
    repeatedSmall: repeated,
  };
}

export async function buildMonthly(period: Period) {
  const { year, month } = dhakaParts(period.start);
  const prev = precedingMonth(year, month);
  const [cur, before, balances, budgets, loans, top, repeated, savings, profile] = await Promise.all([
    getSummary(period),
    getSummary(prev),
    getBalances(),
    budgetStatus(year, month),
    getLoanSummary(),
    topExpenses(period, 5),
    repeatedSmallExpenses(period),
    savingsProgress(),
    getProfile(),
  ]);
  return {
    period: period.label,
    summary: cur.summary,
    categories: cur.categories,
    previous: { period: prev.label, summary: before.summary, categories: before.categories },
    expenseChange: percentChange(cur.summary.expenses, before.summary.expenses),
    incomeChange: percentChange(cur.summary.income, before.summary.income),
    balances,
    budgets: budgets.rows,
    loans,
    topExpenses: top.map((t) => ({ description: t.description, amount: t.amount, category: t.category, date: dayKey(t.transactionDate) })),
    repeatedSmall: repeated,
    savings: { goals: savings.goals, emergencyFund: savings.emergencyFund },
    monthlySalary: profile.monthlySalary ?? 0,
  };
}

function precedingMonth(year: number, month: number) {
  return month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1);
}

const MONEY_KEYS = new Set(["income", "grossExpenses", "refunds", "expenses", "netCashFlow", "savingsTransfers", "investments", "loansGiven", "loansReceived", "repaymentsReceived", "repaymentsPaid", "interestPaid", "amount", "total", "balance", "allocated", "spent", "remaining", "outstanding", "totalReceivable", "totalPayable", "target", "saved", "monthlySalary", "todayIncome", "todayExpenses", "openingBalance", "allocatedAmount", "targetAmount", "interestAmount", "savingsBalance", "net", "savings", "totalIncome", "totalExpenses", "totalSavings", "remainingBalance"]);

/** Converts poisha fields to taka and replaces category ids with labels, so Claude reads human figures. */
export function toAIInput(value: any, key = "", keepIds = false): any {
  if (Array.isArray(value)) return value.map((v) => toAIInput(v, key, keepIds));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (!keepIds && (k === "id" || k === "accountId")) continue;
      out[k] = k === "category" && typeof v === "string" && !keepIds ? categoryLabel(v) : toAIInput(v, k, keepIds);
    }
    return out;
  }
  return typeof value === "number" && MONEY_KEYS.has(key) ? toTaka(value) : value;
}

/** Same taka conversion for API/MCP consumers, keeping ids and category ids. */
export const inTaka = (value: any) => toAIInput(value, "", true);

export function hashData(data: unknown) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 32);
}

// ---------- formatting (Telegram HTML) ----------
export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const pct = (v: number | null) => (v === null ? "new" : `${v > 0 ? "+" : ""}${v}%`);

function categoryLines(cats: { category: string; amount: number; share: number }[], limit = 8) {
  return cats.slice(0, limit).map((c) => `• ${escapeHtml(categoryLabel(c.category))}: ${formatBDT(c.amount)} (${c.share}%)`);
}

export function formatDaily(d: Awaited<ReturnType<typeof buildDaily>>) {
  return [
    `<b>Daily balance — ${d.period}</b>`,
    "",
    `Total balance: <b>${formatBDT(d.balances.total)}</b>`,
    ...d.balances.accounts.map((a) => `• ${escapeHtml(a.name)}: ${formatBDT(a.balance)}`),
    "",
    `Today's spending: ${formatBDT(d.todayExpenses)}`,
    `Today's income: ${formatBDT(d.todayIncome)}`,
  ].join("\n");
}

export function formatWeekly(d: Awaited<ReturnType<typeof buildWeekly>>, ai?: string | null) {
  const s = d.summary;
  const top = d.categories[0];
  return [
    `<b>Weekly report — ${d.period}</b>`,
    "",
    `Income: ${formatBDT(s.income)}`,
    `Expenses: ${formatBDT(s.expenses)} (${pct(d.expenseChange)} vs previous 7 days: ${formatBDT(d.previous.summary.expenses)})`,
    `Net: ${formatBDT(s.netCashFlow, { sign: true })}`,
    `Remaining balance: <b>${formatBDT(d.balance)}</b>`,
    top ? `Highest category: ${escapeHtml(categoryLabel(top.category))} (${formatBDT(top.amount)})` : "No expenses recorded.",
    "",
    d.categories.length ? "<b>By category</b>" : "",
    ...categoryLines(d.categories),
    d.topExpenses.length ? "\n<b>Biggest expenses</b>" : "",
    ...d.topExpenses.map((t) => `• ${escapeHtml(t.description)} ${formatBDT(t.amount)} (${t.date.slice(5)})`),
    ai ? `\n<b>Claude's notes</b>\n${escapeHtml(ai)}` : "",
  ].filter((l) => l !== "").join("\n");
}

export function formatMonthly(d: Awaited<ReturnType<typeof buildMonthly>>, ai?: string | null) {
  const s = d.summary;
  return [
    `<b>Monthly report — ${d.period}</b>`,
    "",
    `Income: ${formatBDT(s.income)} (${pct(d.incomeChange)})`,
    `Expenses: ${formatBDT(s.expenses)} (${pct(d.expenseChange)} vs ${d.previous.period})`,
    `Net cash flow: ${formatBDT(s.netCashFlow, { sign: true })}`,
    `Savings rate: ${s.savingsRate}%  •  Moved to savings: ${formatBDT(s.savingsTransfers)}`,
    "",
    `<b>Balances — ${formatBDT(d.balances.total)}</b>`,
    ...d.balances.accounts.map((a) => `• ${escapeHtml(a.name)}: ${formatBDT(a.balance)}`),
    d.categories.length ? "\n<b>By category</b>" : "",
    ...categoryLines(d.categories, 10),
    d.budgets.length ? "\n<b>Budgets</b>" : "",
    ...d.budgets.map((b) => `• ${escapeHtml(b.category === "total" ? "Overall" : categoryLabel(b.category))}: ${formatBDT(b.spent)} / ${formatBDT(b.allocated)} (${b.utilization}%)${b.alert === "over" ? " ⚠️" : ""}`),
    d.loans.totalReceivable || d.loans.totalPayable ? `\n<b>Loans</b>\nOthers owe you: ${formatBDT(d.loans.totalReceivable)}\nYou owe: ${formatBDT(d.loans.totalPayable)}` : "",
    ai ? `\n<b>Claude's advice</b>\n${escapeHtml(ai)}` : "",
  ].filter((l) => l !== "").join("\n");
}

/** Splits on line boundaries to stay under Telegram's 4096-char limit. */
export function splitMessage(text: string, max = 3900): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${line}` : line.slice(0, max);
  }
  if (cur) parts.push(cur);
  return parts;
}

// ---------- periods ----------
/** The period a scheduled run covers, given when it runs. */
export function scheduledPeriod(type: ReportType, runAt: Date): Period {
  if (type === "daily") return dayPeriod(runAt);
  if (type === "weekly") return last7DaysPeriod(runAt);
  return previousMonthPeriod(runAt);
}

export function periodKey(type: ReportType, p: Period) {
  return `${type}:${p.label}`;
}

// ---------- generate + deliver ----------
export interface GenerateResult {
  report: any;
  text: string;
}

/** Builds (or refreshes) the report for a period. Claude is called only when the figures changed. */
export async function generateReport(type: ReportType, period: Period, opts: { withAI?: boolean } = {}): Promise<GenerateResult> {
  const key = periodKey(type, period);
  await Report.updateOne(
    { reportType: type, periodKey: key },
    { $setOnInsert: { reportType: type, periodKey: key, periodStart: period.start, periodEnd: period.end } },
    { upsert: true },
  );
  const existing = (await Report.findOne({ reportType: type, periodKey: key }).lean())!;
  const data: any = type === "daily" ? await buildDaily(period) : type === "weekly" ? await buildWeekly(period) : await buildMonthly(period);
  const dataHash = hashData(data);
  let aiAnalysis = existing.dataHash === dataHash ? existing.aiAnalysis : undefined;
  let aiError: string | undefined;
  let freshAI = false;
  if (type !== "daily" && opts.withAI !== false && !aiAnalysis && aiEnabled()) {
    try {
      aiAnalysis = await analyze(type, toAIInput(data));
      freshAI = true;
    } catch (err) {
      aiError = describeAIError(err);
      console.error(JSON.stringify({ level: "error", msg: "claude_analysis_failed", reportType: type, period: period.label, error: aiError }));
    }
  }
  // Without a fresh analysis (no API key, or it failed) keep the last one, e.g. advice saved from Claude Desktop.
  aiAnalysis = aiAnalysis ?? existing.aiAnalysis ?? undefined;
  const summary = type === "daily" ? null : data.summary;
  const report = await Report.findOneAndUpdate(
    { _id: existing._id },
    {
      $set: {
        data,
        dataHash,
        aiAnalysis: aiAnalysis ?? null,
        aiError: aiError ?? null,
        ...(freshAI && { aiSource: "api" }),
        generatedAt: new Date(),
        totalIncome: type === "daily" ? data.todayIncome : summary.income,
        totalExpenses: type === "daily" ? data.todayExpenses : summary.expenses,
        totalSavings: summary?.savingsTransfers ?? 0,
        remainingBalance: type === "monthly" ? data.balances.total : type === "weekly" ? data.balance : data.balances.total,
        categoryBreakdown: data.categories ?? [],
      },
    },
    { returnDocument: "after" },
  ).lean();
  const text = type === "daily" ? formatDaily(data) : type === "weekly" ? formatWeekly(data, aiAnalysis) : formatMonthly(data, aiAnalysis);
  return { report, text };
}

/** Stores analysis written elsewhere (Claude Desktop via the MCP save_insight tool) on the period's report. */
export async function saveInsight(type: "weekly" | "monthly", period: Period, analysis: string) {
  const { report } = await generateReport(type, period, { withAI: false });
  return Report.findOneAndUpdate(
    { _id: report!._id },
    { $set: { aiAnalysis: analysis.trim(), aiSource: "claude-desktop", aiError: null, generatedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
}

export const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60_000;

/**
 * Idempotent scheduled delivery. A period is delivered at most once; partial multi-part sends resume
 * where they stopped; "delivered" is only written after Telegram confirmed every part.
 */
export async function deliverReport(type: ReportType, period: Period, send: (text: string) => Promise<unknown>, now = new Date()) {
  const key = periodKey(type, period);
  await Report.updateOne(
    { reportType: type, periodKey: key },
    { $setOnInsert: { reportType: type, periodKey: key, periodStart: period.start, periodEnd: period.end } },
    { upsert: true },
  );
  const locked = await Report.findOneAndUpdate(
    {
      reportType: type,
      periodKey: key,
      deliveryStatus: { $in: ["pending", "failed", "delivering"] },
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [{ lockedUntil: null }, { lockedUntil: { $exists: false } }, { lockedUntil: { $lt: now } }],
    },
    { $set: { deliveryStatus: "delivering", lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!locked) return { status: "skipped" as const };
  try {
    const { text } = await generateReport(type, period);
    const parts = splitMessage(text);
    for (let i = locked.deliveredParts ?? 0; i < parts.length; i++) {
      await send(parts[i]);
      await Report.updateOne({ _id: locked._id }, { $set: { deliveredParts: i + 1 } });
    }
    await Report.updateOne({ _id: locked._id }, { $set: { deliveryStatus: "delivered", deliveredAt: new Date(), lockedUntil: null, lastError: null } });
    return { status: "delivered" as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
    await Report.updateOne({ _id: locked._id }, { $set: { deliveryStatus: "failed", lockedUntil: null, lastError: msg } });
    console.error(JSON.stringify({ level: "error", msg: "report_delivery_failed", key, attempt: locked.attempts, error: msg }));
    return { status: "failed" as const, error: msg };
  }
}

/** Periods that should already have been delivered as of `now` (used for catch-up after restarts). */
export function duePeriods(now: Date): { type: ReportType; period: Period }[] {
  const p = dhakaParts(now);
  const hour = dhakaHour(now);
  const out: { type: ReportType; period: Period }[] = [];
  // Daily at 22:00: today's if past 22:00, else yesterday's.
  out.push({ type: "daily", period: dayPeriod(hour >= 22 ? now : addDays(now, -1)) });
  // Weekly on Sunday 21:00: the most recent Sunday whose 21:00 has passed.
  const daysSinceSunday = p.weekday === 0 && hour < 21 ? 7 : p.weekday;
  out.push({ type: "weekly", period: last7DaysPeriod(addDays(now, -daysSinceSunday)) });
  // Monthly on the 1st 09:00: previous month once past that moment, else the one before.
  const monthlyRef = p.day === 1 && hour < 9 ? addDays(now, -1) : now;
  out.push({ type: "monthly", period: previousMonthPeriod(monthlyRef) });
  return out;
}
