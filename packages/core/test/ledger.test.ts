import { describe, expect, it } from "vitest";
import { accountBalances, categoryBreakdown, loanSummary, summarize, type LedgerEntry } from "../src/ledger";

const accounts = [
  { id: "cash", name: "Cash", type: "cash", openingBalance: 500000 },
  { id: "bank", name: "Bank", type: "bank", openingBalance: 2000000 },
  { id: "bkash", name: "bKash", type: "bkash", openingBalance: 0 },
  { id: "card", name: "Card", type: "credit_card", openingBalance: 0 },
  { id: "sav", name: "Savings", type: "savings", openingBalance: 0 },
];

const month: LedgerEntry[] = [
  { type: "income", amount: 4000000, category: "salary", accountId: "bank" },
  { type: "expense", amount: 1000000, category: "housing", accountId: "bank" },
  { type: "expense", amount: 3000, category: "groceries", accountId: "cash" },
  { type: "expense", amount: 15000, category: "food", accountId: "bkash" },
  { type: "transfer", amount: 500000, accountId: "bank", toAccountId: "bkash" },
  { type: "expense", amount: 200000, category: "shopping", accountId: "card" },
  { type: "transfer", amount: 200000, accountId: "bank", toAccountId: "card" }, // card bill
  { type: "refund", amount: 50000, category: "shopping", accountId: "bkash" },
  { type: "savings", amount: 300000, accountId: "bank", toAccountId: "sav" },
  { type: "loan_given", amount: 200000, accountId: "cash", counterparty: "Amit" },
  { type: "loan_repayment", amount: 50000, loanKind: "receivable", accountId: "cash", counterparty: "Amit" },
  { type: "loan_received", amount: 1000000, accountId: "bank", counterparty: "Karim" },
  { type: "loan_repayment", amount: 210000, interestAmount: 10000, loanKind: "payable", accountId: "bank", counterparty: "Karim" },
];

describe("summarize", () => {
  const s = summarize(month);
  it("counts only earned income (no loans, no transfers)", () => expect(s.income).toBe(4000000));
  it("expenses exclude transfers, card payments, savings and loan principal; include interest; net of refunds", () => {
    expect(s.grossExpenses).toBe(1000000 + 3000 + 15000 + 200000);
    expect(s.interestPaid).toBe(10000);
    expect(s.expenses).toBe(1218000 + 10000 - 50000);
  });
  it("net cash flow and savings rate", () => {
    expect(s.netCashFlow).toBe(4000000 - 1178000);
    expect(s.savingsRate).toBe(70.6);
    expect(s.savingsTransfers).toBe(300000);
  });
  it("no income yields 0 savings rate", () => expect(summarize([{ type: "expense", amount: 100 }]).savingsRate).toBe(0));
});

describe("accountBalances", () => {
  const { accounts: rows, total } = accountBalances(accounts, month);
  const bal = Object.fromEntries(rows.map((r) => [r.id, r.balance]));
  it("applies each rule per account", () => {
    expect(bal.cash).toBe(500000 - 3000 - 200000 + 50000);
    expect(bal.bkash).toBe(500000 - 15000 + 50000);
    expect(bal.card).toBe(0); // purchase and bill payment net out, counted once as expense
    expect(bal.sav).toBe(300000);
    expect(bal.bank).toBe(2000000 + 4000000 - 1000000 - 500000 - 200000 - 300000 + 1000000 - 210000);
  });
  it("total = opening + net cash flow + net loan principal", () => {
    const s = summarize(month);
    const opening = 2500000;
    const loanNet = s.loansReceived - s.repaymentsPaid - s.loansGiven + s.repaymentsReceived;
    expect(total).toBe(opening + s.netCashFlow + loanNet);
  });
});

describe("categoryBreakdown", () => {
  it("refunds reduce their category and interest is its own category", () => {
    const rows = categoryBreakdown(month);
    expect(rows.find((r) => r.category === "shopping")!.amount).toBe(150000);
    expect(rows.find((r) => r.category === "interest")!.amount).toBe(10000);
    expect(rows[0].category).toBe("housing");
  });
});

describe("loanSummary", () => {
  it("tracks receivables and payables by principal", () => {
    const l = loanSummary(month);
    expect(l.receivables).toEqual([{ counterparty: "Amit", outstanding: 150000 }]);
    expect(l.payables).toEqual([{ counterparty: "Karim", outstanding: 800000 }]);
  });
});
