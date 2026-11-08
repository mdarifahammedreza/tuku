import { describe, expect, it, vi } from "vitest";
import { useTestDB } from "../../../packages/core/test/setup-db";
import { Report, Transaction, setTelegramReplyId } from "@finance/core";
import * as h from "../src/handlers";
import { catchUp } from "../src/scheduler";

useTestDB();

describe("authorization", () => {
  it("only allowlisted user ids pass", () => {
    const allow = h.parseAllowlist("123, 456,abc,");
    expect([...allow]).toEqual([123, 456]);
    expect(h.isAuthorized(123, allow)).toBe(true);
    expect(h.isAuthorized(999, allow)).toBe(false);
    expect(h.isAuthorized(undefined, allow)).toBe(false);
    expect(h.isAuthorized(1, h.parseAllowlist(""))).toBe(false);
  });
});

describe("transaction messages", () => {
  it("records several lines and replies in the expected format", async () => {
    const r = await h.handleTransactionMessage(42, 1, "alu 30\nporatha 30\ncha 15");
    expect(r.text).toContain("3 transactions recorded.");
    expect(r.text).toMatch(/Alu\s+৳30/);
    expect(r.text).toContain("Total: ৳75");
    expect(r.text).toContain("Today's expenses: ৳75");
  });

  it("saves nothing when any line is unclear", async () => {
    const r = await h.handleTransactionMessage(42, 2, "alu 30\nsomething");
    expect(r.text).toContain("Nothing was saved");
    expect(r.savedIds).toBeUndefined();
    expect(await Transaction.countDocuments()).toBe(0);
  });

  it("duplicate update does not double-save", async () => {
    await h.handleTransactionMessage(42, 3, "rickshaw 40");
    const again = await h.handleTransactionMessage(42, 3, "rickshaw 40");
    expect(again.text).toContain("Already recorded");
    expect(await Transaction.countDocuments()).toBe(1);
  });

  it("fix and undo via reply to confirmation", async () => {
    const r = await h.handleTransactionMessage(42, 4, "lunch 150");
    await setTelegramReplyId(r.savedIds!, 500);
    expect(await h.fixText(42, "120", 500)).toContain("৳120");
    expect(await h.fixText(42, "category transport")).toContain("Transport");
    expect(await h.undoText(42, 500)).toContain("Reversed");
    expect(await h.periodText("today")).toContain("Expenses: ৳0");
  });

  it("accounts, default and opening balance", async () => {
    expect(await h.addAccountText("bkash bKash 1500")).toContain("৳1,500");
    expect(await h.setDefaultText("bkash")).toContain("bKash");
    await h.handleTransactionMessage(42, 5, "cha 15");
    expect(await Transaction.findOne({ telegramMessageId: 5 }).lean()).toMatchObject({ paymentMethod: "bkash" });
    const text = await h.openingText("cash 5000");
    expect(text).toContain("Total balance: ৳6,485");
  });

  it("budget command sets and reports utilization", async () => {
    await h.handleTransactionMessage(42, 6, "lunch 450");
    const t = await h.budgetText("food 500");
    expect(t).toContain("🟡");
    expect(t).toContain("(90%)");
    expect(await h.budgetText("nonsense 5")).toContain("Unknown category");
  });
});

describe("scheduler catch-up", () => {
  it("delivers due reports once to the registered chat", async () => {
    await h.registerChat(42);
    const send = vi.fn().mockResolvedValue({});
    await catchUp(send);
    await catchUp(send);
    expect(send).toHaveBeenCalledTimes(3); // daily + weekly + monthly, once each
    expect(send.mock.calls.every((c) => c[0] === 42)).toBe(true);
    expect(await Report.countDocuments({ deliveryStatus: "delivered" })).toBe(3);
  });
});
