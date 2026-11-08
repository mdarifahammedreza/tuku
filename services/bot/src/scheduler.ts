import cron from "node-cron";
import { TIMEZONE, deliverReport, duePeriods, getProfile, scheduledPeriod, type ReportType } from "@finance/core";
import { log } from "./log";

export type Sender = (chatId: number, text: string) => Promise<unknown>;

async function reportChat(): Promise<number | undefined> {
  const p = await getProfile();
  return p.reporting?.chatId ?? (Number(process.env.TELEGRAM_REPORT_CHAT_ID) || undefined);
}

export async function runReport(type: ReportType, now: Date, send: Sender, period = scheduledPeriod(type, now)) {
  const profile = await getProfile();
  if (profile.reporting?.[type] === false) return;
  const chatId = await reportChat();
  if (!chatId) {
    log("warn", "no_report_chat", { type, hint: "send /start to the bot or set TELEGRAM_REPORT_CHAT_ID" });
    return;
  }
  const r = await deliverReport(type, period, (text) => send(chatId, text), now);
  if (r.status !== "skipped") log(r.status === "delivered" ? "info" : "error", "report_run", { type, period: period.label, ...r });
}

/** Re-attempts anything due but not yet delivered (restarts, Telegram/Claude outages). */
export async function catchUp(send: Sender, now = new Date()) {
  for (const { type, period } of duePeriods(now)) await runReport(type, now, send, period);
}

export function startScheduler(send: Sender) {
  const guard = (fn: () => Promise<void>) => () => fn().catch((e) => log("error", "scheduler_error", { error: String(e) }));
  const opts = { timezone: TIMEZONE, noOverlap: true };
  cron.schedule("0 22 * * *", guard(() => runReport("daily", new Date(), send)), opts);
  cron.schedule("0 21 * * 0", guard(() => runReport("weekly", new Date(), send)), opts);
  cron.schedule("0 9 1 * *", guard(() => runReport("monthly", new Date(), send)), opts);
  cron.schedule("*/15 * * * *", guard(() => catchUp(send)), opts);
  setTimeout(guard(() => catchUp(send)), 10_000);
  log("info", "scheduler_started", { timezone: TIMEZONE });
}
