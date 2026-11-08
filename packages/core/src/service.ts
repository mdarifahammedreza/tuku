// Data-access + business operations shared by the web app, Telegram bot and MCP server.
import mongoose, { Types } from "mongoose";
import type { z } from "zod";
import { Account, AuditLog, Budget, Confirmation, Profile, Report, Transaction } from "./models";
import { accountBalances, categoryBreakdown, loanSummary, summarize, type LedgerEntry } from "./ledger";
import { toPoisha } from "./money";
import { addDays, currentMonthPeriod, dhakaParts, monthPeriod, TIMEZONE, type Period } from "./dates";
import type { AccountType, ParsedTransaction } from "./parser";
import type { accountInput, accountPatch, budgetInput, goalInput, profilePatch, transactionFilters, transactionInput, transactionPatch } from "./validation";

export type Source = "telegram" | "web" | "mcp" | "system";

export class FinanceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ---------- serialization ----------
/** Converts lean Mongo docs into plain JSON (ObjectId -> string, _id -> id). */
export function plain<T = any>(doc: any): T {
  if (doc == null) return doc;
  if (Array.isArray(doc)) return doc.map(plain) as T;
  if (doc instanceof Types.ObjectId) return doc.toString() as T;
  if (doc instanceof Date) return doc as T;
  if (typeof doc === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(doc)) out[k === "_id" ? "id" : k] = plain(v);
    return out;
  }
  return doc;
}

async function audit(action: string, entity: string, entityId: string, before: unknown, after: unknown, source: Source) {
  await AuditLog.create({ action, entity, entityId, before: plain(before), after: plain(after), source });
}

// ---------- setup / profile ----------
export async function ensureSetup() {
  await Promise.all([Account, Transaction, Budget, Profile, Report, AuditLog, Confirmation].map((m: any) => m.createIndexes()));
  // Several services run this at boot; duplicate-key races are expected and harmless.
  const ignoreDup = (e: any) => {
    if (e?.code !== 11000) throw e;
  };
  if (!(await Account.exists({ type: "cash" }))) await Account.create({ name: "Cash", type: "cash", openingBalance: 0 }).catch(ignoreDup);
  if (!(await Account.exists({ type: "savings" }))) await Account.create({ name: "Savings", type: "savings", openingBalance: 0 }).catch(ignoreDup);
  const cash = (await Account.findOne({ type: "cash" }).sort({ createdAt: 1 }).lean())!;
  await Profile.updateOne({ key: "default" }, { $setOnInsert: { key: "default", defaultAccountId: cash._id } }, { upsert: true }).catch(ignoreDup);
}

export async function getProfile() {
  const p = await Profile.findOne({ key: "default" }).lean();
  if (!p) throw new FinanceError("Profile not initialised", 500);
  return p;
}

export async function updateProfile(patch: z.infer<typeof profilePatch>, source: Source) {
  const before = await getProfile();
  const set: Record<string, unknown> = {};
  if (patch.monthlySalary !== undefined) set.monthlySalary = toPoisha(patch.monthlySalary);
  if (patch.emergencyFundTarget !== undefined) set.emergencyFundTarget = toPoisha(patch.emergencyFundTarget);
  if (patch.defaultAccountId) {
    if (!(await Account.exists({ _id: patch.defaultAccountId, isActive: true }))) throw new FinanceError("Account not found", 404);
    set.defaultAccountId = patch.defaultAccountId;
  }
  if (patch.incomeSources) set.incomeSources = patch.incomeSources.map((s) => ({ name: s.name, amount: toPoisha(s.amount) }));
  if (patch.reporting) for (const [k, v] of Object.entries(patch.reporting)) set[`reporting.${k}`] = v;
  if (patch.categoryKeywords) set.categoryKeywords = patch.categoryKeywords;
  const after = await Profile.findOneAndUpdate({ key: "default" }, { $set: set }, { returnDocument: "after" }).lean();
  await audit("profile.update", "profile", "default", before, after, source);
  return after!;
}

export async function setReportChat(chatId: number) {
  await Profile.updateOne({ key: "default" }, { $set: { "reporting.chatId": chatId } });
}

// ---------- accounts ----------
export async function listAccounts(includeInactive = false) {
  return Account.find(includeInactive ? {} : { isActive: true }).sort({ createdAt: 1 }).lean();
}

export async function createAccount(input: z.infer<typeof accountInput>, source: Source) {
  try {
    const acc = await Account.create({ name: input.name, type: input.type, openingBalance: toPoisha(input.openingBalance) });
    await audit("account.create", "account", acc.id, null, acc.toObject(), source);
    return acc.toObject();
  } catch (e: any) {
    if (e?.code === 11000) throw new FinanceError(`An account named "${input.name}" already exists`, 409);
    throw e;
  }
}

export async function updateAccount(id: string, patch: z.infer<typeof accountPatch>, source: Source) {
  const before = await Account.findById(id).lean();
  if (!before) throw new FinanceError("Account not found", 404);
  const set: Record<string, unknown> = { ...patch };
  if (patch.openingBalance !== undefined) set.openingBalance = toPoisha(patch.openingBalance);
  const after = await Account.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after", runValidators: true }).lean();
  await audit(patch.openingBalance !== undefined ? "account.balance_adjust" : "account.update", "account", id, before, after, source);
  return after!;
}

/** Picks the account a transaction belongs to: an explicit hint, else the profile default. */
export async function resolveAccount(hint: AccountType | undefined, fallbackToDefault = true) {
  const accounts = await listAccounts();
  if (hint) {
    const match = accounts.find((a) => a.type === hint);
    if (match) return match;
    if (hint === "savings") return (await Account.create({ name: "Savings", type: "savings" })).toObject();
    throw new FinanceError(`You don't have a ${hint} account yet. Add one with /addaccount ${hint} <name>.`);
  }
  if (!fallbackToDefault) return undefined;
  const profile = await getProfile();
  const def = accounts.find((a) => a._id.equals(profile.defaultAccountId as any)) ?? accounts.find((a) => a.type === "cash") ?? accounts[0];
  if (!def) throw new FinanceError("No active accounts. Add one first.");
  return def;
}

// ---------- transactions ----------
async function assertAccounts(...ids: (string | Types.ObjectId | null | undefined)[]) {
  for (const id of ids) if (id && !(await Account.exists({ _id: id }))) throw new FinanceError("Account not found", 404);
}

function checkShape(t: { type: string; toAccountId?: unknown; accountId?: unknown; loanKind?: unknown }) {
  if (t.type === "transfer" && !t.toAccountId) throw new FinanceError("A transfer needs a destination account");
  if (t.toAccountId && String(t.toAccountId) === String(t.accountId)) throw new FinanceError("Source and destination accounts must differ");
  if (t.type === "loan_repayment" && !t.loanKind) throw new FinanceError("Specify whether the repayment is receivable or payable");
}

export interface TelegramRecordResult {
  transactions: any[];
  duplicate: boolean;
}

/**
 * Saves every parsed line of one Telegram message. Idempotent on (chatId, messageId):
 * a redelivered update returns the transactions saved the first time.
 */
export async function recordTelegramMessage(chatId: number, messageId: number, parsed: ParsedTransaction[], now = new Date()): Promise<TelegramRecordResult> {
  const existing = await Transaction.find({ telegramChatId: chatId, telegramMessageId: messageId }).sort({ lineIndex: 1 }).lean();
  if (existing.length) return { transactions: existing, duplicate: true };

  const docs = [];
  for (const [i, p] of parsed.entries()) {
    const account = await resolveAccount(p.accountHint);
    const toAccount = p.toAccountHint ? await resolveAccount(p.toAccountHint) : undefined;
    if (p.type === "transfer" && !toAccount) throw new FinanceError("Which account did the money go to? e.g. 'transfer 500 from bank to bkash'.");
    const doc = {
      type: p.type,
      amount: p.amount,
      description: p.description,
      category: p.category,
      accountId: account!._id,
      toAccountId: toAccount?._id,
      counterparty: p.counterparty,
      loanKind: p.loanKind,
      transactionDate: addDays(now, -p.daysAgo),
      paymentMethod: account!.type,
      source: "telegram" as const,
      telegramChatId: chatId,
      telegramMessageId: messageId,
      lineIndex: i,
      notes: p.raw.slice(0, 500),
    };
    checkShape(doc);
    docs.push(doc);
  }
  try {
    await Transaction.insertMany(docs, { ordered: true });
  } catch (e: any) {
    if (e?.code !== 11000) {
      // Roll back any lines of this message that did get written, so the message is all-or-nothing.
      await Transaction.deleteMany({ telegramChatId: chatId, telegramMessageId: messageId, createdAt: { $gte: now } });
      throw e;
    }
    const saved = await Transaction.find({ telegramChatId: chatId, telegramMessageId: messageId }).sort({ lineIndex: 1 }).lean();
    return { transactions: saved, duplicate: true };
  }
  const saved = await Transaction.find({ telegramChatId: chatId, telegramMessageId: messageId }).sort({ lineIndex: 1 }).lean();
  await AuditLog.insertMany(saved.map((t) => ({ action: "transaction.create", entity: "transaction", entityId: t._id.toString(), before: null, after: plain(t), source: "telegram" })));
  return { transactions: saved, duplicate: false };
}

export async function setTelegramReplyId(ids: Types.ObjectId[], replyMessageId: number) {
  await Transaction.updateMany({ _id: { $in: ids } }, { $set: { telegramReplyMessageId: replyMessageId } });
}

export async function createTransaction(input: z.infer<typeof transactionInput>, source: Source) {
  const account = input.accountId ? await Account.findById(input.accountId).lean() : await resolveAccount(undefined);
  if (!account) throw new FinanceError("Account not found", 404);
  await assertAccounts(input.toAccountId);
  const doc = {
    ...input,
    amount: toPoisha(input.amount),
    interestAmount: input.interestAmount ? toPoisha(input.interestAmount) : 0,
    category: input.category ?? (input.type === "income" ? "other_income" : input.type === "expense" || input.type === "refund" ? "other" : input.type.startsWith("loan") ? "loan" : input.type),
    accountId: account._id,
    paymentMethod: account.type,
    transactionDate: input.transactionDate ?? new Date(),
    source,
  };
  checkShape(doc);
  const t = await Transaction.create(doc);
  await audit("transaction.create", "transaction", t.id, null, t.toObject(), source);
  return t.toObject();
}

export async function getTransaction(id: string) {
  const t = await Transaction.findById(id).lean();
  if (!t) throw new FinanceError("Transaction not found", 404);
  return t;
}

export async function correctTransaction(id: string, patch: z.infer<typeof transactionPatch>, source: Source) {
  const before = await getTransaction(id);
  if (before.status !== "confirmed") throw new FinanceError("Reversed transactions cannot be edited", 409);
  const set: Record<string, unknown> = { ...patch };
  const unset: Record<string, 1> = {};
  if (patch.amount !== undefined) set.amount = toPoisha(patch.amount);
  if (patch.interestAmount !== undefined) set.interestAmount = toPoisha(patch.interestAmount);
  if (patch.toAccountId === null) {
    delete set.toAccountId;
    unset.toAccountId = 1;
  }
  await assertAccounts(patch.accountId, patch.toAccountId);
  if (patch.accountId) set.paymentMethod = (await Account.findById(patch.accountId).lean())!.type;
  checkShape({ ...before, ...set, toAccountId: unset.toAccountId ? undefined : (set.toAccountId ?? before.toAccountId) } as any);
  if (((set.interestAmount as number) ?? before.interestAmount ?? 0) > ((set.amount as number) ?? before.amount)) throw new FinanceError("Interest cannot exceed amount");
  // Optimistic concurrency on `revision` so two concurrent edits can't silently overwrite each other.
  const after = await Transaction.findOneAndUpdate(
    { _id: id, revision: before.revision, status: "confirmed" },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $inc: { revision: 1 } },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!after) throw new FinanceError("Transaction changed meanwhile; try again", 409);
  await audit("transaction.correct", "transaction", id, before, after, source);
  return after;
}

/** Reversal keeps the record (status=reversed) so history is never destroyed. */
export async function reverseTransaction(id: string, reason: string, source: Source) {
  const before = await getTransaction(id);
  if (before.status === "reversed") throw new FinanceError("Already reversed", 409);
  const after = await Transaction.findOneAndUpdate(
    { _id: id, status: "confirmed" },
    { $set: { status: "reversed", reversedAt: new Date(), reversalReason: reason.slice(0, 200) }, $inc: { revision: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!after) throw new FinanceError("Already reversed", 409);
  await audit("transaction.reverse", "transaction", id, before, after, source);
  return after;
}

export async function lastTelegramTransactions(chatId: number) {
  const last = await Transaction.findOne({ telegramChatId: chatId, status: "confirmed" }).sort({ createdAt: -1, lineIndex: -1 }).lean();
  return last;
}

export async function findByTelegramReply(chatId: number, replyMessageId: number) {
  return Transaction.find({ telegramChatId: chatId, $or: [{ telegramReplyMessageId: replyMessageId }, { telegramMessageId: replyMessageId }], status: "confirmed" }).sort({ lineIndex: 1 }).lean();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listTransactions(f: z.infer<typeof transactionFilters>) {
  const q: Record<string, any> = {};
  if (f.status !== "all") q.status = f.status;
  if (f.type) q.type = f.type;
  if (f.category) q.category = f.category;
  if (f.accountId) q.$or = [{ accountId: f.accountId }, { toAccountId: f.accountId }];
  if (f.from || f.to) q.transactionDate = { ...(f.from && { $gte: f.from }), ...(f.to && { $lt: f.to }) };
  if (f.q) q.description = { $regex: escapeRe(f.q), $options: "i" };
  const [items, total] = await Promise.all([
    Transaction.find(q).sort({ transactionDate: -1, _id: -1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).lean(),
    Transaction.countDocuments(q),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize, pages: Math.max(1, Math.ceil(total / f.pageSize)) };
}

// ---------- aggregates ----------
const confirmed = (period?: Period, extra: Record<string, unknown> = {}) => ({
  status: "confirmed",
  ...(period && { transactionDate: { $gte: period.start, $lt: period.end } }),
  ...extra,
});

/** Sums transactions by every field the ledger rules depend on; the result feeds the pure ledger functions. */
export async function ledgerEntries(period?: Period, extra: Record<string, unknown> = {}): Promise<LedgerEntry[]> {
  const rows = await Transaction.aggregate([
    { $match: confirmed(period, extra) },
    {
      $group: {
        _id: { type: "$type", category: "$category", accountId: "$accountId", toAccountId: "$toAccountId", loanKind: "$loanKind", counterparty: "$counterparty" },
        amount: { $sum: "$amount" },
        interestAmount: { $sum: { $ifNull: ["$interestAmount", 0] } },
      },
    },
  ]);
  return rows.map((r) => ({
    ...r._id,
    accountId: r._id.accountId?.toString() ?? null,
    toAccountId: r._id.toAccountId?.toString() ?? null,
    amount: r.amount,
    interestAmount: r.interestAmount,
  }));
}

export async function getBalances() {
  const [accounts, entries] = await Promise.all([listAccounts(), ledgerEntries()]);
  return accountBalances(accounts.map((a) => ({ id: a._id.toString(), name: a.name, type: a.type, openingBalance: a.openingBalance })), entries);
}

export async function getSummary(period: Period) {
  const entries = await ledgerEntries(period);
  return { period, summary: summarize(entries), categories: categoryBreakdown(entries) };
}

export async function getLoanSummary() {
  return loanSummary(await ledgerEntries(undefined, { type: { $in: ["loan_given", "loan_received", "loan_repayment"] } }));
}

/** Per-day income/expense for a period, in Dhaka calendar days. */
export async function dailySeries(period: Period) {
  const rows = await Transaction.aggregate([
    { $match: confirmed(period) },
    {
      $group: {
        _id: { day: { $dateToString: { date: "$transactionDate", format: "%Y-%m-%d", timezone: TIMEZONE } }, type: "$type", loanKind: "$loanKind", category: "$category" },
        amount: { $sum: "$amount" },
        interestAmount: { $sum: { $ifNull: ["$interestAmount", 0] } },
      },
    },
  ]);
  const byDay = new Map<string, LedgerEntry[]>();
  for (const r of rows) {
    const list = byDay.get(r._id.day) ?? [];
    list.push({ type: r._id.type, loanKind: r._id.loanKind, category: r._id.category, amount: r.amount, interestAmount: r.interestAmount });
    byDay.set(r._id.day, list);
  }
  const days: { date: string; income: number; expenses: number }[] = [];
  for (let t = period.start.getTime(); t < period.end.getTime(); t += 86_400_000) {
    const key = new Date(t + 6 * 3_600_000).toISOString().slice(0, 10);
    const s = summarize(byDay.get(key) ?? []);
    days.push({ date: key, income: s.income, expenses: s.expenses });
  }
  return days;
}

/** Last `n` calendar months (oldest first) with income, expenses, net and savings transfers. */
export async function monthlySeries(n = 6, now = new Date()) {
  const { year, month } = dhakaParts(now);
  const periods: Period[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = month - i;
    const y = year + Math.floor((m - 1) / 12);
    periods.push(monthPeriod(y, ((((m - 1) % 12) + 12) % 12) + 1));
  }
  const rows = await Transaction.aggregate([
    { $match: { status: "confirmed", transactionDate: { $gte: periods[0].start, $lt: periods[n - 1].end } } },
    {
      $group: {
        _id: { month: { $dateToString: { date: "$transactionDate", format: "%Y-%m", timezone: TIMEZONE } }, type: "$type", loanKind: "$loanKind", category: "$category" },
        amount: { $sum: "$amount" },
        interestAmount: { $sum: { $ifNull: ["$interestAmount", 0] } },
      },
    },
  ]);
  return periods.map((p) => {
    const s = summarize(rows.filter((r) => r._id.month === p.label).map((r) => ({ ...r._id, amount: r.amount, interestAmount: r.interestAmount })));
    return { month: p.label, income: s.income, expenses: s.expenses, net: s.netCashFlow, savings: s.savingsTransfers, savingsRate: s.savingsRate };
  });
}

export async function topExpenses(period: Period, limit = 10) {
  return Transaction.find(confirmed(period, { type: "expense" })).sort({ amount: -1 }).limit(limit).lean();
}

export async function categoryTrends(periods: Period[]) {
  return Promise.all(periods.map(async (p) => ({ period: p.label, categories: categoryBreakdown(await ledgerEntries(p)) })));
}

/** Repeated small purchases (same description) — a common budget leak. */
export async function repeatedSmallExpenses(period: Period, maxAmount = 50000, minCount = 3) {
  return Transaction.aggregate([
    { $match: confirmed(period, { type: "expense", amount: { $lte: maxAmount } }) },
    { $group: { _id: { $toLower: "$description" }, count: { $sum: 1 }, total: { $sum: "$amount" }, category: { $first: "$category" } } },
    { $match: { count: { $gte: minCount } } },
    { $sort: { total: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, description: "$_id", count: 1, total: 1, category: 1 } },
  ]);
}

// ---------- budgets ----------
export async function setBudget(input: z.infer<typeof budgetInput>, source: Source) {
  const key = { year: input.year, month: input.month, category: input.category };
  const before = await Budget.findOne(key).lean();
  const after = await Budget.findOneAndUpdate(key, { $set: { allocatedAmount: toPoisha(input.allocatedAmount) } }, { upsert: true, returnDocument: "after", runValidators: true }).lean();
  await audit("budget.set", "budget", after!._id.toString(), before, after, source);
  return after!;
}

export async function listBudgets(year?: number, month?: number) {
  return Budget.find({ ...(year && { year }), ...(month && { month }) }).sort({ year: -1, month: -1, category: 1 }).lean();
}

export async function budgetStatus(year: number, month: number) {
  const period = monthPeriod(year, month);
  const [budgets, entries] = await Promise.all([Budget.find({ year, month }).lean(), ledgerEntries(period)]);
  const cats = categoryBreakdown(entries);
  const total = summarize(entries).expenses;
  const rows = budgets.map((b) => {
    const spent = b.category === "total" ? total : (cats.find((c) => c.category === b.category)?.amount ?? 0);
    const utilization = b.allocatedAmount > 0 ? Math.round((spent / b.allocatedAmount) * 1000) / 10 : spent > 0 ? 100 : 0;
    return {
      id: b._id.toString(),
      category: b.category,
      allocated: b.allocatedAmount,
      spent,
      remaining: b.allocatedAmount - spent,
      utilization,
      alert: utilization >= 100 ? ("over" as const) : utilization >= 80 ? ("warning" as const) : ("ok" as const),
    };
  });
  return { period: period.label, rows: rows.sort((a, b) => (a.category === "total" ? -1 : b.category === "total" ? 1 : b.utilization - a.utilization)) };
}

// ---------- goals ----------
export async function createSavingsGoal(input: z.infer<typeof goalInput>, source: Source) {
  await assertAccounts(input.accountId);
  const before = await getProfile();
  const after = await Profile.findOneAndUpdate(
    { key: "default" },
    { $push: { goals: { name: input.name, targetAmount: toPoisha(input.targetAmount), accountId: input.accountId, deadline: input.deadline } } },
    { returnDocument: "after" },
  ).lean();
  await audit("goal.create", "profile", "default", before.goals, after!.goals, source);
  return after!.goals.at(-1)!;
}

export async function savingsProgress() {
  const [profile, balances] = await Promise.all([getProfile(), getBalances()]);
  const savingsBalance = balances.accounts.filter((a) => a.type === "savings").reduce((t, a) => t + a.balance, 0);
  const goals = await Promise.all(
    (profile.goals ?? []).map(async (g: any) => {
      let saved: number;
      if (g.accountId) saved = balances.accounts.find((a) => a.id === g.accountId!.toString())?.balance ?? 0;
      else saved = summarize(await ledgerEntries({ start: g.createdAt ?? new Date(0), end: new Date(8.64e15), label: "" }, { type: "savings" })).savingsTransfers;
      return { id: g._id.toString(), name: g.name, target: g.targetAmount, saved, progress: g.targetAmount ? Math.min(100, Math.round((saved / g.targetAmount) * 1000) / 10) : 0, deadline: g.deadline ?? null };
    }),
  );
  const month = await getSummary(currentMonthPeriod());
  return {
    savingsBalance,
    emergencyFund: { target: profile.emergencyFundTarget ?? 0, saved: savingsBalance, progress: profile.emergencyFundTarget ? Math.min(100, Math.round((savingsBalance / profile.emergencyFundTarget) * 1000) / 10) : 0 },
    thisMonth: { savingsTransfers: month.summary.savingsTransfers, netCashFlow: month.summary.netCashFlow, savingsRate: month.summary.savingsRate },
    goals,
  };
}

// ---------- dashboard ----------
export async function getOverview(now = new Date()) {
  const month = currentMonthPeriod(now);
  const [balances, current, daily, recent, loans, budgets] = await Promise.all([
    getBalances(),
    getSummary(month),
    dailySeries(month),
    Transaction.find({ status: "confirmed" }).sort({ transactionDate: -1, _id: -1 }).limit(8).lean(),
    getLoanSummary(),
    budgetStatus(dhakaParts(now).year, dhakaParts(now).month),
  ]);
  return { period: month, balances, summary: current.summary, categories: current.categories, daily, recent, loans, budgets: budgets.rows };
}

export async function getAuditLog(limit = 50) {
  return AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean();
}

export { mongoose };
