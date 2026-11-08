// MCP tools/resources. Every tool maps to a fixed, validated service call — no raw queries.
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CATEGORIES, Confirmation, FinanceError, budgetStatus, buildMonthly, buildWeekly, categoryTrends, correctTransaction, createSavingsGoal,
  currentMonthPeriod, dailySeries, dayPeriod, dhakaMidnight, dhakaParts, getBalances, getLoanSummary, getProfile, getSummary, getTransaction,
  inTaka, last7DaysPeriod, listAccounts, listTransactions, monthPeriod, objectId, previousMonthPeriod, reverseTransaction, savingsProgress,
  setBudget, topExpenses, transactionPatch, type Period, TX_TYPES, goalInput, plain,
} from "@finance/core";

const PERIODS = ["today", "last_7_days", "this_month", "last_month"] as const;
const periodShape = {
  period: z.enum(PERIODS).optional().describe("Named period (Asia/Dhaka). Ignored if from/to given. Default this_month."),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (inclusive, Dhaka)"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD (inclusive, Dhaka)"),
};

function toPeriod(a: { period?: (typeof PERIODS)[number]; from?: string; to?: string }): Period {
  if (a.from || a.to) {
    const [fy, fm, fd] = (a.from ?? "2000-01-01").split("-").map(Number);
    const end = a.to ? a.to.split("-").map(Number) : null;
    const start = dhakaMidnight(fy, fm, fd);
    const endD = end ? new Date(dhakaMidnight(end[0], end[1], end[2]).getTime() + 86_400_000) : dayPeriod().end;
    if (endD <= start) throw new FinanceError("'to' must be on or after 'from'");
    if (endD.getTime() - start.getTime() > 3 * 366 * 86_400_000) throw new FinanceError("Range too large (max 3 years)");
    return { start, end: endD, label: `${a.from ?? "2000-01-01"}..${a.to ?? "today"}` };
  }
  switch (a.period ?? "this_month") {
    case "today": return dayPeriod();
    case "last_7_days": return last7DaysPeriod();
    case "last_month": return previousMonthPeriod();
    default: return currentMonthPeriod();
  }
}

const NOTE = "All money values are BDT taka. Figures are computed deterministically from the ledger.";

function ok(data: unknown) {
  const structured = { ...inTaka(plain(data)), note: NOTE };
  return { content: [{ type: "text" as const, text: JSON.stringify(structured) }], structuredContent: structured };
}

function fail(e: unknown) {
  const msg = e instanceof FinanceError || e instanceof z.ZodError ? e.message : "Internal error";
  if (!(e instanceof FinanceError) && !(e instanceof z.ZodError)) console.error(JSON.stringify({ level: "error", service: "mcp", msg: "tool_error", error: String(e) }));
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

const wrap = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try {
    return ok(await fn(a));
  } catch (e) {
    return fail(e);
  }
};

const RO = { readOnlyHint: true, openWorldHint: false };
const MUT = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/**
 * Two-step confirmation for mutations: the first call (no confirm_token) returns a preview and a
 * one-time token; the change runs only when called again with that token after the user said yes.
 */
async function confirmable(tool: string, args: Record<string, unknown>, preview: () => Promise<unknown>, run: (args: any) => Promise<unknown>) {
  const { confirm_token, ...rest } = args as any;
  if (!confirm_token) {
    const token = randomBytes(16).toString("hex");
    await Confirmation.create({ token, tool, args: rest, expiresAt: new Date(Date.now() + 10 * 60_000) });
    return {
      requires_confirmation: true,
      confirm_token: token,
      expires_in_minutes: 10,
      preview: await preview(),
      instructions: "Show this preview to the user and ask for explicit confirmation. Only if they confirm, call this tool again with the same arguments plus confirm_token.",
    };
  }
  const pending = await Confirmation.findOneAndDelete({ token: confirm_token, tool, expiresAt: { $gt: new Date() } }).lean();
  if (!pending) throw new FinanceError("Invalid or expired confirm_token. Call without it to get a new preview.");
  if (JSON.stringify(pending.args) !== JSON.stringify(JSON.parse(JSON.stringify(rest)))) throw new FinanceError("Arguments differ from the confirmed preview. Start again without confirm_token.");
  return { done: true, result: await run(pending.args) };
}

const confirmToken = z.string().regex(/^[a-f\d]{32}$/).optional().describe("Token from the preview call; only send after the user explicitly confirmed.");

export function createMcpServer() {
  const server = new McpServer({ name: "personal-finance", version: "1.0.0" });

  server.registerTool("get_financial_overview", {
    title: "Financial overview",
    description: "Income, expenses, net cash flow, savings, account balances and outstanding loans for a period.",
    inputSchema: periodShape,
    annotations: RO,
  }, wrap(async (a) => {
    const p = toPeriod(a);
    const [s, balances, loans] = await Promise.all([getSummary(p), getBalances(), getLoanSummary()]);
    return { period: p.label, ...s.summary, balances, loans: { totalReceivable: loans.totalReceivable, totalPayable: loans.totalPayable } };
  }));

  server.registerTool("get_transactions", {
    title: "List transactions",
    description: "Paginated transactions, newest first. Filters: date range, category id, account id, type, text search.",
    inputSchema: {
      ...periodShape,
      category: z.string().max(40).optional(),
      account_id: objectId.optional(),
      type: z.enum(TX_TYPES).optional(),
      search: z.string().max(100).optional(),
      include_reversed: z.boolean().optional(),
      page: z.number().int().min(1).max(1000).optional(),
      page_size: z.number().int().min(1).max(100).optional(),
    },
    annotations: RO,
  }, wrap(async (a) => {
    const p = a.period || a.from || a.to ? toPeriod(a) : undefined;
    const r = await listTransactions({
      from: p?.start, to: p?.end, category: a.category, accountId: a.account_id, type: a.type, q: a.search,
      status: a.include_reversed ? "all" : "confirmed", page: a.page ?? 1, pageSize: a.page_size ?? 25,
    });
    const { total, ...rest } = r;
    return { ...rest, totalCount: total, items: r.items.map(({ telegramChatId, telegramMessageId, telegramReplyMessageId, lineIndex, ...t }: any) => t) };
  }));

  server.registerTool("get_expense_summary", {
    title: "Expense summary by category",
    description: "Net expense per category (refunds deducted) with share of total.",
    inputSchema: periodShape,
    annotations: RO,
  }, wrap(async (a) => {
    const p = toPeriod(a);
    const s = await getSummary(p);
    return { period: p.label, totalExpenses: s.summary.expenses, categories: s.categories.map((c) => ({ ...c, label: CATEGORIES.find((x) => x.id === c.category)?.label ?? c.category })) };
  }));

  server.registerTool("get_daily_expenses", {
    title: "Daily expenses",
    description: "Income and expenses for every Dhaka calendar day in the period.",
    inputSchema: periodShape,
    annotations: RO,
  }, wrap(async (a) => {
    const p = toPeriod(a);
    return { period: p.label, days: (await dailySeries(p)).map((d) => ({ date: d.date, income: d.income, expenses: d.expenses })) };
  }));

  server.registerTool("get_weekly_report", {
    title: "Weekly report data",
    description: "Structured 7-day summary (ending today) with comparison to the previous 7 days.",
    inputSchema: {},
    annotations: RO,
  }, wrap(() => buildWeekly(last7DaysPeriod())));

  server.registerTool("get_monthly_report", {
    title: "Monthly report data",
    description: "Complete monthly summary: categories, budgets, balances, loans, savings, previous-month comparison.",
    inputSchema: { year: z.number().int().min(2000).max(2100).optional(), month: z.number().int().min(1).max(12).optional() },
    annotations: RO,
  }, wrap(async (a) => {
    const now = dhakaParts(new Date());
    return buildMonthly(monthPeriod(a.year ?? now.year, a.month ?? now.month));
  }));

  server.registerTool("get_category_trends", {
    title: "Category trends",
    description: "Category-wise spending for each of the last N calendar months (oldest first).",
    inputSchema: { months: z.number().int().min(2).max(12).optional() },
    annotations: RO,
  }, wrap(async (a) => {
    const n = a.months ?? 3;
    const { year, month } = dhakaParts(new Date());
    const periods = Array.from({ length: n }, (_, i) => {
      const m = month - (n - 1 - i);
      return monthPeriod(year + Math.floor((m - 1) / 12), ((((m - 1) % 12) + 12) % 12) + 1);
    });
    return { trends: await categoryTrends(periods) };
  }));

  server.registerTool("get_budget_status", {
    title: "Budget status",
    description: "Allocated vs actual per category for a month, with 80%/100% alerts.",
    inputSchema: { year: z.number().int().min(2000).max(2100).optional(), month: z.number().int().min(1).max(12).optional() },
    annotations: RO,
  }, wrap(async (a) => {
    const now = dhakaParts(new Date());
    return budgetStatus(a.year ?? now.year, a.month ?? now.month);
  }));

  server.registerTool("get_remaining_balance", {
    title: "Account balances",
    description: "Current balance of every active account and the total.",
    inputSchema: {},
    annotations: RO,
  }, wrap(() => getBalances()));

  server.registerTool("get_top_expenses", {
    title: "Top expenses",
    description: "Largest individual expenses in a period.",
    inputSchema: { ...periodShape, limit: z.number().int().min(1).max(50).optional() },
    annotations: RO,
  }, wrap(async (a) => {
    const p = toPeriod(a);
    return { period: p.label, items: (await topExpenses(p, a.limit ?? 10)).map((t) => ({ id: t._id, description: t.description, amount: t.amount, category: t.category, date: t.transactionDate })) };
  }));

  server.registerTool("get_loan_summary", {
    title: "Loans",
    description: "Outstanding receivables (others owe me) and payables (I owe), by person.",
    inputSchema: {},
    annotations: RO,
  }, wrap(() => getLoanSummary()));

  server.registerTool("get_savings_progress", {
    title: "Savings progress",
    description: "Savings goals, emergency fund and this month's savings rate.",
    inputSchema: {},
    annotations: RO,
  }, wrap(() => savingsProgress()));

  // ---- controlled mutations ----
  server.registerTool("correct_transaction", {
    title: "Correct a transaction",
    description: "Change fields of a transaction (amount in taka, category id, description, date, account). Two-step: returns a preview + confirm_token first.",
    inputSchema: {
      transaction_id: objectId,
      amount: z.number().positive().max(1_000_000_000).optional(),
      category: z.string().max(40).optional(),
      description: z.string().min(1).max(200).optional(),
      transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      account_id: objectId.optional(),
      confirm_token: confirmToken,
    },
    annotations: MUT,
  }, wrap((a: any) => {
    const patch = transactionPatch.parse({
      amount: a.amount, category: a.category, description: a.description, accountId: a.account_id,
      transactionDate: a.transaction_date ? new Date(dhakaMidnight(...(a.transaction_date.split("-").map(Number) as [number, number, number])).getTime() + 12 * 3_600_000) : undefined,
    });
    return confirmable("correct_transaction", a, async () => ({ before: await getTransaction(a.transaction_id), changes: patch }), (args) =>
      correctTransaction(args.transaction_id, patch, "mcp"));
  }));

  server.registerTool("reverse_transaction", {
    title: "Reverse a transaction",
    description: "Mark a transaction as reversed (kept in history, excluded from totals). Two-step confirmation.",
    inputSchema: { transaction_id: objectId, reason: z.string().min(1).max(200), confirm_token: confirmToken },
    annotations: MUT,
  }, wrap((a: any) => confirmable("reverse_transaction", a, () => getTransaction(a.transaction_id), (args) => reverseTransaction(args.transaction_id, args.reason, "mcp"))));

  server.registerTool("set_monthly_budget", {
    title: "Set a monthly budget",
    description: "Set allocated taka for a category id (or 'total') for a month. Two-step confirmation.",
    inputSchema: {
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
      category: z.string().min(1).max(40),
      amount: z.number().min(0).max(1_000_000_000),
      confirm_token: confirmToken,
    },
    annotations: MUT,
  }, wrap((a: any) => {
    if (a.category !== "total" && !CATEGORIES.some((c) => c.id === a.category)) throw new FinanceError(`Unknown category. Valid: total, ${CATEGORIES.filter((c) => c.kind === "expense").map((c) => c.id).join(", ")}`);
    return confirmable("set_monthly_budget", a, async () => ({ ...a, current: (await budgetStatus(a.year, a.month)).rows.find((r) => r.category === a.category) ?? null }), (args) =>
      setBudget({ year: args.year, month: args.month, category: args.category, allocatedAmount: args.amount }, "mcp"));
  }));

  server.registerTool("create_savings_goal", {
    title: "Create a savings goal",
    description: "Create a savings goal (target in taka, optional linked account and deadline YYYY-MM-DD). Two-step confirmation.",
    inputSchema: {
      name: z.string().min(1).max(80),
      target_amount: z.number().positive().max(1_000_000_000),
      account_id: objectId.optional(),
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      confirm_token: confirmToken,
    },
    annotations: MUT,
  }, wrap((a: any) => {
    const input = goalInput.parse({ name: a.name, targetAmount: a.target_amount, accountId: a.account_id, deadline: a.deadline });
    return confirmable("create_savings_goal", a, async () => input, () => createSavingsGoal(input, "mcp"));
  }));

  // ---- resources ----
  const json = (uri: string, data: unknown) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(inTaka(plain(data))) }] });
  server.registerResource("profile", "finance://profile", { description: "Financial profile (salary, goals, reporting settings)", mimeType: "application/json" }, async (uri) => {
    const { categoryKeywords, reporting, ...p } = (await getProfile()) as any;
    return json(uri.href, { ...p, reporting: { daily: reporting?.daily, weekly: reporting?.weekly, monthly: reporting?.monthly } });
  });
  server.registerResource("accounts", "finance://accounts", { description: "Accounts with balances", mimeType: "application/json" }, async (uri) =>
    json(uri.href, { accounts: await listAccounts(), balances: await getBalances() }));
  server.registerResource("current-month", "finance://current-month", { description: "This month's summary", mimeType: "application/json" }, async (uri) =>
    json(uri.href, await getSummary(currentMonthPeriod())));
  server.registerResource("current-budgets", "finance://current-budgets", { description: "This month's budget status", mimeType: "application/json" }, async (uri) => {
    const { year, month } = dhakaParts(new Date());
    return json(uri.href, await budgetStatus(year, month));
  });

  return server;
}
