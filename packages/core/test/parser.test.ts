import { describe, expect, it } from "vitest";
import { parseLine, parseMessage } from "../src/parser";

const ok = (s: string) => {
  const r = parseLine(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.tx;
};

describe("parser: compact expenses", () => {
  it.each([
    ["alu:30 tk", 3000, "Alu", "groceries"],
    ["poratha 30 taka", 3000, "Poratha", "food"],
    ["rickshaw 40", 4000, "Rickshaw", "transport"],
    ["lunch 150 taka", 15000, "Lunch", "food"],
    ["spent 150 on lunch", 15000, "Lunch", "food"],
    ["cha ৳15", 1500, "Cha", "food"],
    ["alu30tk", 3000, "Alu", "groceries"],
    ["paid 10000 rent", 1000000, "Rent", "housing"],
    ["alu 2 kg 60", 6000, "Alu 2 kg", "groceries"],
    ["medicine 1.5k", 150000, "Medicine", "health"],
    ["internet bill 1,200 tk", 120000, "Internet bill", "utilities"],
    ["chocolate 99.50", 9950, "Chocolate", "other"],
  ])("%s", (input, amount, description, category) => {
    const tx = ok(input);
    expect(tx).toMatchObject({ type: "expense", amount, description, category });
  });

  it("handles Bangla script and digits", () => {
    expect(ok("আলু ৩০ টাকা")).toMatchObject({ type: "expense", amount: 3000, category: "groceries", description: "আলু" });
    expect(ok("চা ১৫")).toMatchObject({ amount: 1500, category: "food" });
    expect(ok("বেতন ৪০০০০")).toMatchObject({ type: "income", amount: 4000000, category: "salary" });
  });

  it("detects account hints", () => {
    expect(ok("lunch 150 via bkash")).toMatchObject({ accountHint: "bkash", description: "Lunch" });
    expect(ok("medicine 500 nagad")).toMatchObject({ accountHint: "nagad", description: "Medicine" });
  });

  it("detects yesterday", () => {
    expect(ok("dinner 300 yesterday")).toMatchObject({ daysAgo: 1, description: "Dinner" });
  });
});

describe("parser: other transaction types", () => {
  it("income", () => {
    expect(ok("salary received 40000")).toMatchObject({ type: "income", amount: 4000000, category: "salary", description: "Salary" });
    expect(ok("salary 40000")).toMatchObject({ type: "income", category: "salary" });
    expect(ok("got paid 15000 from upwork")).toMatchObject({ type: "income", category: "freelance" });
  });
  it("refund", () => {
    expect(ok("received 500 taka refund")).toMatchObject({ type: "refund", amount: 50000, description: "Refund" });
    expect(ok("daraz refund 1200")).toMatchObject({ type: "refund", category: "shopping" });
  });
  it("loans", () => {
    expect(ok("gave Amit 2000 taka loan")).toMatchObject({ type: "loan_given", amount: 200000, counterparty: "Amit", description: "Loan to Amit" });
    expect(ok("lent rahim 500")).toMatchObject({ type: "loan_given", counterparty: "Rahim" });
    expect(ok("borrowed 5000 from Karim")).toMatchObject({ type: "loan_received", counterparty: "Karim" });
    expect(ok("Amit paid back 1000")).toMatchObject({ type: "loan_repayment", loanKind: "receivable", counterparty: "Amit" });
    expect(ok("repaid 2000 to Karim")).toMatchObject({ type: "loan_repayment", loanKind: "payable", counterparty: "Karim" });
    expect(ok("loan interest 300")).toMatchObject({ type: "expense", category: "interest" });
  });
  it("savings, investment, transfers", () => {
    expect(ok("saved 3000 taka")).toMatchObject({ type: "savings", amount: 300000, toAccountHint: "savings" });
    expect(ok("invested 10000 in sanchaypatra")).toMatchObject({ type: "investment" });
    expect(ok("transfer 5000 from bank to bkash")).toMatchObject({ type: "transfer", accountHint: "bank", toAccountHint: "bkash" });
    expect(ok("paid credit card bill 8000 from bank")).toMatchObject({ type: "transfer", accountHint: "bank", toAccountHint: "credit_card" });
  });
});

describe("parser: never guesses", () => {
  it.each([
    ["lunch", /amount/],
    ["500", /spent on/],
    ["lunch for 2 people 300 and 50", /more than one/],
    ["loan 2000", /loan you gave/],
    ["0 tk lunch", /greater than zero/],
  ])("%s", (input, err) => {
    const r = parseLine(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(err);
  });
});

describe("parser: multi-line messages", () => {
  it("parses one transaction per line", () => {
    const rs = parseMessage("alu 30\nporatha 30\ncha 15");
    expect(rs.map((r) => r.ok && r.tx.amount)).toEqual([3000, 3000, 1500]);
  });
  it("splits on commas without breaking thousands", () => {
    const rs = parseMessage("rent 12,000, rickshaw 40");
    expect(rs.map((r) => r.ok && r.tx.amount)).toEqual([1200000, 4000]);
  });
  it("uses custom keywords", () => {
    const r = parseLine("ps5 controller 6000", { keywords: { gadgets: ["ps5"] } });
    expect(r.ok && r.tx.category).toBe("gadgets");
  });
});
