// Telegram command/message logic, kept free of grammY so it can be unit-tested.
import {
  ACCOUNT_TYPES, CATEGORIES, FinanceError, Profile, budgetStatus, categoryLabel, correctTransaction, createAccount, currentMonthPeriod,
  dayKey, dayPeriod, dhakaParts, escapeHtml, findByTelegramReply, formatBDT, getBalances, getProfile, getSummary, last7DaysPeriod,
  lastTelegramTransactions, listAccounts, listTransactions, parseMessage, recordTelegramMessage, reverseTransaction, setBudget,
  transactionFilters, updateAccount, updateProfile, type AccountType,
} from "@finance/core";

export function parseAllowlist(raw = process.env.TELEGRAM_ALLOWED_USER_IDS ?? ""): Set<number> {
  return new Set(raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isSafeInteger(n) && n > 0));
}

export function isAuthorized(userId: number | undefined, allow: Set<number>): boolean {
  return userId !== undefined && allow.has(userId);
}

const TYPE_TAG: Record<string, string> = {
  income: "income", refund: "refund", transfer: "transfer", savings: "savings", investment: "investment",
  loan_given: "loan given", loan_received: "loan received", loan_repayment: "repayment",
};

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function todayExpenses() {
  return (await getSummary(dayPeriod())).summary.expenses;
}

export interface Reply {
  text: string;
  savedIds?: any[];
}

/** Records every line of a message, or nothing if any line is unclear. Never claims a save that didn't happen. */
export async function handleTransactionMessage(chatId: number, messageId: number, text: string): Promise<Reply> {
  const profile = await getProfile();
  const results = parseMessage(text, { keywords: (profile.categoryKeywords ?? {}) as Record<string, string[]> });
  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    const lines = failures.map((f) => `• <i>${escapeHtml((f as any).raw)}</i> — ${escapeHtml((f as any).error)}`);
    return { text: `Nothing was saved. Please fix and resend:\n${lines.join("\n")}` };
  }
  let saved;
  try {
    saved = await recordTelegramMessage(chatId, messageId, results.map((r) => (r as any).tx));
  } catch (e) {
    if (e instanceof FinanceError) return { text: `Nothing was saved. ${escapeHtml(e.message)}` };
    throw e;
  }
  const txs = saved.transactions;
  const total = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const width = Math.min(18, Math.max(...txs.map((t) => t.description.length)) + 2);
  const rows = txs.map((t) => `${pad(t.description, width)} ${formatBDT(t.amount)}${TYPE_TAG[t.type] ? ` (${TYPE_TAG[t.type]})` : ""}`);
  const head = saved.duplicate ? "Already recorded:" : `${txs.length} transaction${txs.length > 1 ? "s" : ""} recorded.`;
  const parts = [head, "", `<pre>${escapeHtml(rows.join("\n"))}</pre>`];
  if (txs.length > 1 && total) parts.push(`Total: ${formatBDT(total)}`);
  if (txs.length === 1 && txs[0].type === "expense") parts.push(`Category: ${escapeHtml(categoryLabel(txs[0].category))}`);
  parts.push("", `Today's expenses: ${formatBDT(await todayExpenses())}`);
  return { text: parts.join("\n"), savedIds: txs.map((t) => t._id) };
}

export async function balanceText() {
  const b = await getBalances();
  return [`<b>Total balance: ${formatBDT(b.total)}</b>`, ...b.accounts.map((a) => `• ${escapeHtml(a.name)} (${a.type}): ${formatBDT(a.balance)}`)].join("\n");
}

export async function periodText(which: "today" | "week" | "month") {
  const period = which === "today" ? dayPeriod() : which === "week" ? last7DaysPeriod() : currentMonthPeriod();
  const { summary: s, categories } = await getSummary(period);
  const title = which === "today" ? `Today (${dayKey(period.start)})` : which === "week" ? `Last 7 days` : `This month (${period.label})`;
  return [
    `<b>${title}</b>`,
    `Income: ${formatBDT(s.income)}`,
    `Expenses: ${formatBDT(s.expenses)}`,
    `Net: ${formatBDT(s.netCashFlow, { sign: true })}`,
    which === "month" ? `Savings rate: ${s.savingsRate}%` : "",
    categories.length ? "" : "No expenses yet.",
    ...categories.slice(0, 10).map((c) => `• ${escapeHtml(categoryLabel(c.category))}: ${formatBDT(c.amount)}`),
  ].filter(Boolean).join("\n");
}

/** Every keyword per category (built-in + the user's own), so the dictionary is never a mystery. */
export async function categoriesText() {
  const custom = ((await getProfile()).categoryKeywords ?? {}) as Record<string, string[]>;
  const lines = CATEGORIES.filter((c) => c.keywords.length || custom[c.id]?.length).map((c) => {
    const own = custom[c.id]?.length ? `\n  <i>Tomar word:</i> ${escapeHtml(custom[c.id].join(", "))}` : "";
    return `• <b>${c.label}</b> (${c.id})\n  ${escapeHtml(c.keywords.join(", "))}${own}`;
  });
  return [
    "<b>Category dictionary</b>",
    "Message-e ei word thakle oi category-te jay.",
    "",
    ...lines,
    "",
    "Kono word na mille <b>Other</b>-e jay. Thik korte: /fix category housing",
    "Nijer word add korte: dashboard → Settings → Custom category keywords",
  ].join("\n");
}

export async function budgetText(args: string) {
  const { year, month } = dhakaParts(new Date());
  const m = args.trim().match(/^(\S+)\s+([\d.]+)$/);
  if (m) {
    const category = m[1].toLowerCase();
    if (category !== "total" && !CATEGORIES.some((c) => c.id === category)) return `Unknown category "${escapeHtml(category)}". See /categories (use the id, or "total").`;
    await setBudget({ year, month, category, allocatedAmount: Number(m[2]) }, "telegram");
  } else if (args.trim()) return "Usage: /budget  — or  /budget food 5000  — or  /budget total 30000";
  const status = await budgetStatus(year, month);
  if (!status.rows.length) return "No budgets for this month. Set one: /budget total 30000";
  return [
    `<b>Budgets ${status.period}</b>`,
    ...status.rows.map((r) => `${r.alert === "over" ? "🔴" : r.alert === "warning" ? "🟡" : "🟢"} ${escapeHtml(r.category === "total" ? "Overall" : categoryLabel(r.category))}: ${formatBDT(r.spent)} / ${formatBDT(r.allocated)} (${r.utilization}%) — left ${formatBDT(r.remaining)}`),
  ].join("\n");
}

function txLine(t: any) {
  return `${dayKey(t.transactionDate).slice(5)} ${escapeHtml(t.description)} ${formatBDT(t.amount)}${TYPE_TAG[t.type] ? ` (${TYPE_TAG[t.type]})` : ""}`;
}

export async function recentText(q?: string) {
  const list = await listTransactions(transactionFilters.parse({ q: q || undefined, pageSize: 10 }));
  if (!list.items.length) return q ? `No transactions matching "${escapeHtml(q)}".` : "No transactions yet.";
  return [`<b>${q ? `Search: ${escapeHtml(q)} (${list.total})` : "Recent transactions"}</b>`, ...list.items.map(txLine)].join("\n");
}

/** Target = transactions of the replied-to message, else the last one recorded from this chat. */
async function targets(chatId: number, replyTo?: number) {
  if (replyTo) {
    const found = await findByTelegramReply(chatId, replyTo);
    if (found.length) return found;
  }
  const last = await lastTelegramTransactions(chatId);
  return last ? [last] : [];
}

export async function undoText(chatId: number, replyTo?: number) {
  const ts = await targets(chatId, replyTo);
  if (!ts.length) return "Nothing to undo.";
  for (const t of ts) await reverseTransaction(t._id.toString(), "Undone from Telegram", "telegram");
  return `Reversed:\n${ts.map(txLine).join("\n")}\n(kept in history as reversed)`;
}

export async function fixText(chatId: number, args: string, replyTo?: number) {
  const ts = await targets(chatId, replyTo);
  if (!ts.length) return "No transaction to fix.";
  if (ts.length > 1) return "That message has several transactions. Fix them one by one from the dashboard, or /undo and resend.";
  const t = ts[0];
  const a = args.trim();
  let patch: Record<string, unknown>;
  let m;
  if ((m = a.match(/^(?:amount\s+)?([\d.]+)$/i))) patch = { amount: Number(m[1]) };
  else if ((m = a.match(/^category\s+(\S+)$/i))) {
    const cat = m[1].toLowerCase();
    if (!CATEGORIES.some((c) => c.id === cat)) return `Unknown category. See /categories.`;
    patch = { category: cat };
  } else if ((m = a.match(/^(?:desc|description)\s+(.+)$/i))) patch = { description: m[1] };
  else if ((m = a.match(/^account\s+(\S+)$/i))) {
    const acc = await findAccount(m[1]);
    if (!acc) return "Account not found. See /accounts.";
    patch = { accountId: acc._id.toString() };
  } else return "Usage: /fix 45 | /fix category food | /fix desc Lunch with team | /fix account bkash  (reply to a confirmation to fix that one)";
  try {
    const after = await correctTransaction(t._id.toString(), patch as any, "telegram");
    return `Updated: ${txLine(after)} — ${escapeHtml(categoryLabel(after.category))}`;
  } catch (e) {
    if (e instanceof FinanceError) return escapeHtml(e.message);
    throw e;
  }
}

async function findAccount(nameOrType: string) {
  const key = nameOrType.toLowerCase();
  const accounts = await listAccounts();
  return accounts.find((a) => a.name.toLowerCase() === key) ?? accounts.find((a) => a.type === key);
}

export async function accountsText() {
  const profile = await getProfile();
  const b = await getBalances();
  return [
    "<b>Accounts</b>",
    ...b.accounts.map((a) => `• ${escapeHtml(a.name)} (${a.type})${String(profile.defaultAccountId) === a.id ? " ⭐ default" : ""}: ${formatBDT(a.balance)}`),
    "",
    "Add: /addaccount bkash bKash 1500\nDefault: /setdefault bkash\nOpening balance: /opening cash 5000",
  ].join("\n");
}

export async function addAccountText(args: string) {
  const m = args.trim().match(/^(\S+)\s+(.+?)(?:\s+(-?[\d.]+))?$/);
  if (!m || !ACCOUNT_TYPES.includes(m[1].toLowerCase() as AccountType)) return `Usage: /addaccount <type> <name> [opening]\nTypes: ${ACCOUNT_TYPES.join(", ")}`;
  try {
    const a = await createAccount({ type: m[1].toLowerCase() as AccountType, name: m[2], openingBalance: m[3] ? Number(m[3]) : 0 }, "telegram");
    return `Added ${escapeHtml(a.name)} (${a.type}) with opening balance ${formatBDT(a.openingBalance)}.`;
  } catch (e) {
    if (e instanceof FinanceError) return escapeHtml(e.message);
    throw e;
  }
}

export async function setDefaultText(args: string) {
  const acc = await findAccount(args.trim());
  if (!acc) return "Account not found. See /accounts.";
  await updateProfile({ defaultAccountId: acc._id.toString() }, "telegram");
  return `Default account is now ${escapeHtml(acc.name)}.`;
}

export async function openingText(args: string) {
  const m = args.trim().match(/^(\S+)\s+(-?[\d.]+)$/);
  if (!m) return "Usage: /opening cash 5000";
  const acc = await findAccount(m[1]);
  if (!acc) return "Account not found. See /accounts.";
  const after = await updateAccount(acc._id.toString(), { openingBalance: Number(m[2]) }, "telegram");
  return `Opening balance of ${escapeHtml(after.name)} set to ${formatBDT(after.openingBalance)}.\n\n${await balanceText()}`;
}

export async function registerChat(chatId: number) {
  await Profile.updateOne({ key: "default" }, { $set: { "reporting.chatId": chatId } });
}

/** /start and /help: greeting, how to record, commands, then the full category dictionary. */
export async function helpText() {
  return `Assalamu alaikum! I'll record your income and expenses.\nReports will be sent to this chat.\n\n${HELP}\n\n${await categoriesText()}`;
}

export const HELP = `<b>Record money by just typing:</b>
alu 30
poratha 30 taka
rickshaw 40 bkash
salary 40000
gave Amit 2000 loan
Amit paid back 500
received 500 refund
saved 3000
transfer 5000 from bank to bkash
(one per line for several at once)

<b>Commands</b>
/balance — balances by account
/today /week /month — summaries
/recent — last 10  •  /search alu
/budget — status  •  /budget food 5000
/report — weekly report now  •  /report month
/undo — reverse last  •  /fix 45  •  /fix category food
/accounts  /addaccount  /setdefault  /opening
/categories`;
