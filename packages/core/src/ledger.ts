// Pure, deterministic accounting rules. Every financial figure shown anywhere comes from here.
// Inputs can be raw transactions or pre-grouped sums (all effects are linear in amount).
import type { LoanKind, TxType } from "./parser";

export interface LedgerEntry {
  type: TxType;
  amount: number; // poisha, always positive
  interestAmount?: number; // part of a loan repayment that is interest
  category?: string;
  accountId?: string | null;
  toAccountId?: string | null;
  loanKind?: LoanKind | null;
  counterparty?: string | null;
  transactionDate?: Date;
}

export interface Summary {
  income: number;
  grossExpenses: number;
  refunds: number;
  expenses: number; // gross expenses + interest - refunds
  netCashFlow: number; // income - expenses
  savingsRate: number; // netCashFlow / income, 0 when no income
  savingsTransfers: number;
  investments: number;
  loansGiven: number;
  loansReceived: number;
  repaymentsReceived: number;
  repaymentsPaid: number;
  interestPaid: number;
  count: number;
}

export function summarize(entries: LedgerEntry[]): Summary {
  const s: Summary = { income: 0, grossExpenses: 0, refunds: 0, expenses: 0, netCashFlow: 0, savingsRate: 0, savingsTransfers: 0, investments: 0, loansGiven: 0, loansReceived: 0, repaymentsReceived: 0, repaymentsPaid: 0, interestPaid: 0, count: 0 };
  for (const e of entries) {
    s.count++;
    const interest = e.interestAmount ?? 0;
    switch (e.type) {
      case "income": s.income += e.amount; break;
      case "expense": s.grossExpenses += e.amount; break;
      case "refund": s.refunds += e.amount; break;
      case "savings": s.savingsTransfers += e.amount; break;
      case "investment": s.investments += e.amount; break;
      case "loan_given": s.loansGiven += e.amount; break;
      case "loan_received": s.loansReceived += e.amount; break;
      case "loan_repayment":
        if (e.loanKind === "receivable") { s.repaymentsReceived += e.amount - interest; s.income += interest; }
        else { s.repaymentsPaid += e.amount - interest; s.interestPaid += interest; }
        break;
      case "transfer": break;
    }
  }
  s.expenses = s.grossExpenses + s.interestPaid - s.refunds;
  s.netCashFlow = s.income - s.expenses;
  s.savingsRate = s.income > 0 ? Math.round((s.netCashFlow / s.income) * 1000) / 10 : 0;
  return s;
}

/** Cash effect of an entry on its source account and destination account. */
export function accountEffects(e: LedgerEntry): { from: number; to: number } {
  switch (e.type) {
    case "income":
    case "refund":
    case "loan_received":
      return { from: e.amount, to: 0 };
    case "loan_repayment":
      return { from: e.loanKind === "receivable" ? e.amount : -e.amount, to: 0 };
    case "transfer":
    case "savings":
    case "investment":
      return { from: -e.amount, to: e.toAccountId ? e.amount : 0 };
    default:
      return { from: -e.amount, to: 0 };
  }
}

export interface AccountLike {
  id: string;
  name: string;
  type: string;
  openingBalance: number;
}

export function accountBalances(accounts: AccountLike[], entries: LedgerEntry[]) {
  const bal = new Map(accounts.map((a) => [a.id, a.openingBalance]));
  for (const e of entries) {
    const { from, to } = accountEffects(e);
    if (e.accountId && bal.has(e.accountId)) bal.set(e.accountId, bal.get(e.accountId)! + from);
    if (e.toAccountId && bal.has(e.toAccountId)) bal.set(e.toAccountId, bal.get(e.toAccountId)! + to);
  }
  const rows = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: bal.get(a.id)! }));
  // A credit card balance is negative when money is owed; it is still part of the net total.
  return { accounts: rows, total: rows.reduce((t, r) => t + r.balance, 0) };
}

/** Net expense per category (refunds reduce their category; loan interest counts as "interest"). */
export function categoryBreakdown(entries: LedgerEntry[]) {
  const m = new Map<string, number>();
  const add = (c: string, v: number) => m.set(c, (m.get(c) ?? 0) + v);
  for (const e of entries) {
    if (e.type === "expense") add(e.category ?? "other", e.amount);
    else if (e.type === "refund") add(e.category ?? "other", -e.amount);
    else if (e.type === "loan_repayment" && e.loanKind !== "receivable" && e.interestAmount) add("interest", e.interestAmount);
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()]
    .filter(([, v]) => v !== 0)
    .map(([category, amount]) => ({ category, amount, share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** Outstanding receivables (money others owe me) and payables (money I owe), by counterparty. */
export function loanSummary(entries: LedgerEntry[]) {
  const recv = new Map<string, number>();
  const pay = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const e of entries) {
    const who = e.counterparty || "Unspecified";
    const principal = e.amount - (e.interestAmount ?? 0);
    if (e.type === "loan_given") add(recv, who, e.amount);
    else if (e.type === "loan_received") add(pay, who, e.amount);
    else if (e.type === "loan_repayment") add(e.loanKind === "receivable" ? recv : pay, who, -principal);
  }
  const rows = (m: Map<string, number>) => [...m.entries()].map(([counterparty, outstanding]) => ({ counterparty, outstanding })).filter((r) => r.outstanding !== 0).sort((a, b) => b.outstanding - a.outstanding);
  const receivables = rows(recv);
  const payables = rows(pay);
  return {
    receivables,
    payables,
    totalReceivable: receivables.reduce((t, r) => t + r.outstanding, 0),
    totalPayable: payables.reduce((t, r) => t + r.outstanding, 0),
  };
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
