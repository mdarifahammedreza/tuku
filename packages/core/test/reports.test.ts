import { describe, expect, it, vi } from "vitest";
import { useTestDB } from "./setup-db";
import { Report, deliverReport, duePeriods, formatWeekly, buildWeekly, last7DaysPeriod, monthPeriod, parseMessage, recordTelegramMessage, scheduledPeriod, splitMessage, dhakaMidnight, type ParsedTransaction } from "../src";

useTestDB();

const parsed = (t: string) => parseMessage(t).map((r) => (r as any).tx) as ParsedTransaction[];

describe("periods", () => {
  it("weekly run on Sunday 21:00 Dhaka covers Mon..Sun", () => {
    const sunday9pm = new Date(dhakaMidnight(2026, 11, 8).getTime() + 21 * 3_600_000);
    expect(scheduledPeriod("weekly", sunday9pm).label).toBe("2026-11-02..2026-11-08");
    expect(scheduledPeriod("monthly", dhakaMidnight(2026, 12, 1)).label).toBe("2026-11");
    expect(scheduledPeriod("monthly", dhakaMidnight(2026, 1, 1)).label).toBe("2025-12");
  });
  it("catch-up picks the latest due periods", () => {
    const monMorning = new Date(dhakaMidnight(2026, 11, 9).getTime() + 8 * 3_600_000);
    const due = Object.fromEntries(duePeriods(monMorning).map((d) => [d.type, d.period.label]));
    expect(due).toEqual({ daily: "2026-11-08", weekly: "2026-11-02..2026-11-08", monthly: "2026-10" });
    const sunEvening = new Date(dhakaMidnight(2026, 11, 8).getTime() + 20 * 3_600_000);
    expect(Object.fromEntries(duePeriods(sunEvening).map((d) => [d.type, d.period.label])).weekly).toBe("2026-10-26..2026-11-01");
  });
  it("splits long messages", () => {
    const parts = splitMessage(Array.from({ length: 500 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n"));
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 3900)).toBe(true);
  });
});

describe("delivery idempotency", () => {
  it("delivers once, even when run again or concurrently", async () => {
    await recordTelegramMessage(1, 1, parsed("lunch 150\nrickshaw 40"));
    const period = last7DaysPeriod();
    const send = vi.fn().mockResolvedValue({});
    const results = await Promise.all([deliverReport("weekly", period, send), deliverReport("weekly", period, send)]);
    expect(results.map((r) => r.status).sort()).toEqual(["delivered", "skipped"]);
    expect((await deliverReport("weekly", period, send)).status).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("Expenses: ৳190");
    const r = await Report.findOne().lean();
    expect(r).toMatchObject({ deliveryStatus: "delivered", totalExpenses: 19000, attempts: 1 });
  });

  it("never marks delivered when Telegram fails, retries later, and stops after max attempts", async () => {
    const period = monthPeriod(2026, 10);
    const fail = vi.fn().mockRejectedValue(new Error("Telegram 502"));
    expect((await deliverReport("monthly", period, fail)).status).toBe("failed");
    expect((await Report.findOne().lean())!.deliveryStatus).toBe("failed");
    const ok = vi.fn().mockResolvedValue({});
    expect((await deliverReport("monthly", period, ok)).status).toBe("delivered");
    for (let i = 0; i < 6; i++) await deliverReport("daily", last7DaysPeriod(), fail);
    expect((await Report.findOne({ reportType: "daily" }).lean())!.attempts).toBe(5);
  });

  it("resumes multi-part delivery without resending confirmed parts", async () => {
    const period = last7DaysPeriod();
    await Report.create({ reportType: "weekly", periodKey: `weekly:${period.label}`, periodStart: period.start, periodEnd: period.end, deliveredParts: 1, deliveryStatus: "failed" });
    const send = vi.fn().mockResolvedValue({});
    await deliverReport("weekly", period, send);
    expect(send).toHaveBeenCalledTimes(0); // the short report has a single part, already confirmed
  });

  it("formats weekly report from real data", async () => {
    await recordTelegramMessage(1, 2, parsed("salary 40000\nrent 10000"));
    const text = formatWeekly(await buildWeekly(last7DaysPeriod()));
    expect(text).toContain("Income: ৳40,000");
    expect(text).toContain("Highest category: Rent &amp; Housing");
  });
});
