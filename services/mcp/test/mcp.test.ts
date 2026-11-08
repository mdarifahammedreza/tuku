import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { useTestDB } from "../../../packages/core/test/setup-db";
import { Transaction, parseMessage, recordTelegramMessage } from "@finance/core";
import { createMcpServer } from "../src/tools";
import { checkBearer, rateLimiter } from "../src/auth";

useTestDB();

async function client() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(a);
  const c = new Client({ name: "test", version: "1" });
  await c.connect(b);
  return c;
}
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as any;

async function seed() {
  const txs = parseMessage("salary 40000\nrent 10000\nlunch 150\nalu 30\ngave Amit 2000 loan").map((r: any) => r.tx);
  await recordTelegramMessage(1, 1, txs);
}

describe("MCP tools", () => {
  it("lists all 17 tools and 4 resources", async () => {
    const c = await client();
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toHaveLength(17);
    expect((await c.listResources()).resources.map((r) => r.uri).sort()).toEqual(["finance://accounts", "finance://current-budgets", "finance://current-month", "finance://profile"]);
  });

  it("returns overview figures in taka", async () => {
    await seed();
    const c = await client();
    const r = await call(c, "get_financial_overview", { period: "this_month" });
    expect(r.structuredContent).toMatchObject({ income: 40000, expenses: 10180, netCashFlow: 29820, loans: { totalReceivable: 2000 } });
    const s = await call(c, "get_expense_summary");
    expect(s.structuredContent.categories[0]).toMatchObject({ category: "housing", amount: 10000, label: "Rent & Housing" });
    const t = await call(c, "get_transactions", { search: "lunch" });
    expect(t.structuredContent.totalCount).toBe(1);
    expect(t.structuredContent.items[0].telegramChatId).toBeUndefined();
    const res = await c.readResource({ uri: "finance://current-month" });
    expect(JSON.parse((res.contents[0] as any).text).summary.income).toBe(40000);
  });

  it("validates arguments", async () => {
    const c = await client();
    const r = await call(c, "get_transactions", { account_id: "not-an-id" });
    expect(r.isError).toBe(true);
    const r2 = await call(c, "get_daily_expenses", { from: "2026-11-09", to: "2026-11-01" });
    expect(r2.isError).toBe(true);
  });

  it("mutations need a confirmed two-step flow", async () => {
    await seed();
    const c = await client();
    const lunch = await Transaction.findOne({ description: "Lunch" }).lean();
    const args = { transaction_id: lunch!._id.toString(), reason: "duplicate" };
    const preview = await call(c, "reverse_transaction", args);
    expect(preview.structuredContent.requires_confirmation).toBe(true);
    expect((await Transaction.findById(lunch!._id).lean())!.status).toBe("confirmed");
    const token = preview.structuredContent.confirm_token;
    const tampered = await call(c, "reverse_transaction", { ...args, reason: "other", confirm_token: token });
    expect(tampered.isError).toBe(true);
    const preview2 = await call(c, "reverse_transaction", args);
    const done = await call(c, "reverse_transaction", { ...args, confirm_token: preview2.structuredContent.confirm_token });
    expect(done.structuredContent.done).toBe(true);
    expect((await Transaction.findById(lunch!._id).lean())!.status).toBe("reversed");
    const replay = await call(c, "reverse_transaction", { ...args, confirm_token: preview2.structuredContent.confirm_token });
    expect(replay.isError).toBe(true);
  });

  it("set_monthly_budget and create_savings_goal", async () => {
    const c = await client();
    const b = { year: 2026, month: 11, category: "food", amount: 5000 };
    const p = await call(c, "set_monthly_budget", b);
    await call(c, "set_monthly_budget", { ...b, confirm_token: p.structuredContent.confirm_token });
    expect((await call(c, "get_budget_status", { year: 2026, month: 11 })).structuredContent.rows[0]).toMatchObject({ category: "food", allocated: 5000 });
    expect((await call(c, "set_monthly_budget", { ...b, category: "bogus" })).isError).toBe(true);
    const g = { name: "Laptop", target_amount: 80000 };
    const gp = await call(c, "create_savings_goal", g);
    await call(c, "create_savings_goal", { ...g, confirm_token: gp.structuredContent.confirm_token });
    expect((await call(c, "get_savings_progress")).structuredContent.goals[0]).toMatchObject({ name: "Laptop", target: 80000 });
  });
});

describe("save_insight", () => {
  it("stores Claude Desktop analysis on the report and keeps it when figures are rebuilt", async () => {
    await seed();
    const c = await client();
    const r = await call(c, "save_insight", { type: "monthly", analysis: "SUMMARY\n• Rent is 98% of spending this month." });
    expect(r.structuredContent).toMatchObject({ saved: true });
    const { Report, generateReport, currentMonthPeriod } = await import("@finance/core");
    const doc = await Report.findOne({ reportType: "monthly" }).lean();
    expect(doc).toMatchObject({ aiSource: "claude-desktop" });
    expect(doc!.aiAnalysis).toContain("Rent is 98%");
    const again = await generateReport("monthly", currentMonthPeriod());
    expect(again.text).toContain("Rent is 98%");
    expect((await call(c, "save_insight", { type: "weekly", analysis: "short" })).isError).toBe(true);
  });
});

describe("MCP auth", () => {
  const secret = "a".repeat(40);
  it("bearer token check", () => {
    expect(checkBearer(`Bearer ${secret}`, secret)).toBe(true);
    expect(checkBearer(`Bearer wrong`, secret)).toBe(false);
    expect(checkBearer(undefined, secret)).toBe(false);
    expect(checkBearer(`Bearer short`, "short")).toBe(false); // too-short configured secrets are rejected
  });
  it("rate limiter", () => {
    const l = rateLimiter(2, 1000);
    expect([l("x", 0), l("x", 1), l("x", 2), l("x", 2000)]).toEqual([true, true, false, true]);
  });
});
