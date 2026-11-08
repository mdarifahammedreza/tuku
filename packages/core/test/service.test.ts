import { describe, expect, it } from "vitest";
import { useTestDB } from "./setup-db";
import {
  Account, AuditLog, Transaction, budgetStatus, correctTransaction, createAccount, createTransaction, currentMonthPeriod, dailySeries,
  getBalances, getLoanSummary, getOverview, getSummary, listTransactions, parseMessage, recordTelegramMessage, reverseTransaction, setBudget,
  transactionFilters, type ParsedTransaction,
} from "../src";

useTestDB();

const parsed = (text: string) => parseMessage(text).map((r) => {
  if (!r.ok) throw new Error(r.error);
  return r.tx;
}) as ParsedTransaction[];

describe("Telegram recording", () => {
  it("saves 'alu:30 tk' to the default cash account", async () => {
    const r = await recordTelegramMessage(111, 1, parsed("alu:30 tk"));
    expect(r.duplicate).toBe(false);
    expect(r.transactions).toHaveLength(1);
    const t = await Transaction.findOne().lean();
    expect(t).toMatchObject({ type: "expense", amount: 3000, category: "groceries", source: "telegram", paymentMethod: "cash" });
    const bal = await getBalances();
    expect(bal.accounts.find((a) => a.type === "cash")!.balance).toBe(-3000);
    expect(await AuditLog.countDocuments({ action: "transaction.create" })).toBe(1);
  });

  it("is idempotent for duplicate Telegram updates", async () => {
    await recordTelegramMessage(111, 7, parsed("alu 30\nporatha 30\ncha 15"));
    const again = await recordTelegramMessage(111, 7, parsed("alu 30\nporatha 30\ncha 15"));
    expect(again.duplicate).toBe(true);
    expect(again.transactions).toHaveLength(3);
    expect(await Transaction.countDocuments()).toBe(3);
    // concurrent redelivery
    await Promise.allSettled([recordTelegramMessage(111, 8, parsed("tea 10")), recordTelegramMessage(111, 8, parsed("tea 10"))]);
    expect(await Transaction.countDocuments({ telegramMessageId: 8 })).toBe(1);
  });

  it("rejects a message that names a missing account without saving anything", async () => {
    await expect(recordTelegramMessage(111, 9, parsed("lunch 100\nmedicine 50 nagad"))).rejects.toThrow(/nagad account/);
    expect(await Transaction.countDocuments()).toBe(0);
  });

  it("routes savings into the savings account and transfers between accounts", async () => {
    await createAccount({ name: "bKash", type: "bkash", openingBalance: 0 }, "web");
    await createAccount({ name: "City Bank", type: "bank", openingBalance: 10000 }, "web");
    await recordTelegramMessage(1, 1, parsed("saved 3000 taka\ntransfer 2000 from bank to bkash\nsalary 40000 bank"));
    const bal = await getBalances();
    const by = Object.fromEntries(bal.accounts.map((a) => [a.type, a.balance]));
    expect(by).toMatchObject({ cash: -300000, savings: 300000, bkash: 200000, bank: 1000000 - 200000 + 4000000 });
    const { summary } = await getSummary(currentMonthPeriod());
    expect(summary).toMatchObject({ income: 4000000, expenses: 0, savingsTransfers: 300000 });
  });
});

describe("corrections and reversals", () => {
  it("corrects with audit trail and optimistic revision", async () => {
    const [t] = (await recordTelegramMessage(1, 2, parsed("lunch 150"))).transactions;
    const fixed = await correctTransaction(t._id.toString(), { amount: 120, category: "food" }, "telegram");
    expect(fixed).toMatchObject({ amount: 12000, revision: 2 });
    const log = await AuditLog.findOne({ action: "transaction.correct" }).lean();
    expect(log!.before.amount).toBe(15000);
    expect(log!.after.amount).toBe(12000);
  });

  it("reversal keeps the record but removes it from totals", async () => {
    const [t] = (await recordTelegramMessage(1, 3, parsed("rent 10000"))).transactions;
    await reverseTransaction(t._id.toString(), "typo", "web");
    expect(await Transaction.countDocuments()).toBe(1);
    expect((await getSummary(currentMonthPeriod())).summary.expenses).toBe(0);
    await expect(reverseTransaction(t._id.toString(), "again", "web")).rejects.toThrow(/Already reversed/);
    await expect(correctTransaction(t._id.toString(), { amount: 1 }, "web")).rejects.toThrow(/cannot be edited/);
  });
});

describe("aggregates", () => {
  it("loans, refunds, budgets, daily series and filters", async () => {
    await recordTelegramMessage(1, 10, parsed("gave Amit 2000 taka loan\nAmit paid back 500\nborrowed 5000 from Karim\nshoes 3000\ndaraz refund 1000\nlunch 200"));
    const loans = await getLoanSummary();
    expect(loans.totalReceivable).toBe(150000);
    expect(loans.totalPayable).toBe(500000);
    const { summary, categories } = await getSummary(currentMonthPeriod());
    expect(summary.income).toBe(0); // loan money is not income
    expect(summary.expenses).toBe(300000 + 20000 - 100000);
    expect(categories.find((c) => c.category === "shopping")!.amount).toBe(200000);

    const now = new Date();
    const { year, month } = { year: Number(currentMonthPeriod().label.slice(0, 4)), month: Number(currentMonthPeriod().label.slice(5)) };
    await setBudget({ year, month, category: "shopping", allocatedAmount: 2400 }, "web");
    await setBudget({ year, month, category: "total", allocatedAmount: 10000 }, "web");
    const b = await budgetStatus(year, month);
    expect(b.rows[0]).toMatchObject({ category: "total", spent: 220000, alert: "ok" });
    expect(b.rows.find((r) => r.category === "shopping")).toMatchObject({ utilization: 83.3, alert: "warning" });

    const days = await dailySeries(currentMonthPeriod(now));
    expect(days.reduce((t, d) => t + d.expenses, 0)).toBe(220000);

    const list = await listTransactions(transactionFilters.parse({ q: "lunch" }));
    expect(list.total).toBe(1);
    const overview = await getOverview();
    expect(overview.recent.length).toBe(6);
  });

  it("web-created transactions validate account references", async () => {
    await expect(createTransaction({ type: "transfer", amount: 10, description: "x", toAccountId: "0123456789abcdef01234567" }, "web")).rejects.toThrow(/Account not found/);
    const cash = await Account.findOne({ type: "cash" }).lean();
    await expect(createTransaction({ type: "transfer", amount: 10, description: "x", toAccountId: cash!._id.toString() }, "web")).rejects.toThrow(/must differ/);
  });
});

describe("setup", () => {
  it("is safe to run concurrently", async () => {
    const { ensureSetup } = await import("../src");
    await Promise.all([ensureSetup(), ensureSetup(), ensureSetup()]);
    expect(await Account.countDocuments({ type: "cash" })).toBe(1);
  });
});
