import { Bot, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { currentMonthPeriod, generateReport, last7DaysPeriod, setTelegramReplyId, splitMessage } from "@finance/core";
import * as h from "./handlers";
import { log } from "./log";

export function createBot(token: string, allow: Set<number>) {
  const bot = new Bot(token);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

  // Only allowlisted Telegram users can talk to the bot.
  bot.use(async (ctx, next) => {
    if (!h.isAuthorized(ctx.from?.id, allow)) {
      log("warn", "unauthorized_telegram_user", { userId: ctx.from?.id });
      if (ctx.chat?.type === "private") await ctx.reply("This bot is private.");
      return;
    }
    await next();
  });

  const reply = async (ctx: Context, text: string) => {
    let last;
    for (const part of splitMessage(text)) last = await ctx.reply(part, { parse_mode: "HTML", reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id, allow_sending_without_reply: true } : undefined });
    return last;
  };
  const args = (ctx: Context) => (typeof ctx.match === "string" ? ctx.match : "");
  const replyTo = (ctx: Context) => ctx.msg?.reply_to_message?.message_id;

  bot.command("start", async (ctx) => {
    await h.registerChat(ctx.chat.id);
    await reply(ctx, `Assalamu alaikum! I'll record your income and expenses.\nReports will be sent to this chat.\n\n${h.HELP}`);
  });
  bot.command("help", (ctx) => reply(ctx, h.HELP));
  bot.command("balance", async (ctx) => reply(ctx, await h.balanceText()));
  bot.command("today", async (ctx) => reply(ctx, await h.periodText("today")));
  bot.command("week", async (ctx) => reply(ctx, await h.periodText("week")));
  bot.command("month", async (ctx) => reply(ctx, await h.periodText("month")));
  bot.command("categories", async (ctx) => reply(ctx, await h.categoriesText()));
  bot.command("budget", async (ctx) => reply(ctx, await h.budgetText(args(ctx))));
  bot.command("recent", async (ctx) => reply(ctx, await h.recentText()));
  bot.command("search", async (ctx) => reply(ctx, args(ctx).trim() ? await h.recentText(args(ctx).trim()) : "Usage: /search alu"));
  bot.command("undo", async (ctx) => reply(ctx, await h.undoText(ctx.chat.id, replyTo(ctx))));
  bot.command("fix", async (ctx) => reply(ctx, await h.fixText(ctx.chat.id, args(ctx), replyTo(ctx))));
  bot.command("accounts", async (ctx) => reply(ctx, await h.accountsText()));
  bot.command("addaccount", async (ctx) => reply(ctx, await h.addAccountText(args(ctx))));
  bot.command("setdefault", async (ctx) => reply(ctx, await h.setDefaultText(args(ctx))));
  bot.command("opening", async (ctx) => reply(ctx, await h.openingText(args(ctx))));
  bot.command("report", async (ctx) => {
    const monthly = /month/i.test(args(ctx));
    await ctx.replyWithChatAction("typing");
    const { text } = monthly ? await generateReport("monthly", currentMonthPeriod()) : await generateReport("weekly", last7DaysPeriod());
    await reply(ctx, text);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.msg.text.startsWith("/")) return reply(ctx, "Unknown command. /help");
    const r = await h.handleTransactionMessage(ctx.chat.id, ctx.msg.message_id, ctx.msg.text);
    const sent = await reply(ctx, r.text);
    if (r.savedIds?.length && sent) await setTelegramReplyId(r.savedIds, sent.message_id);
  });
  bot.on("edited_message", (ctx) => ctx.reply("Edits aren't applied. Use /fix (reply to my confirmation) or /undo."));

  bot.catch(async (err) => {
    log("error", "bot_handler_error", { error: err.error instanceof Error ? err.error.message : String(err.error), updateId: err.ctx.update.update_id });
    try {
      await err.ctx.reply("Something went wrong — nothing new was saved from that message. Please try again.");
    } catch {}
  });

  return bot;
}
