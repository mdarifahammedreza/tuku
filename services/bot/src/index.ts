import { createServer } from "node:http";
import { webhookCallback } from "grammy";
import { connectDB, ensureSetup, mongoose } from "@finance/core";
import { createBot } from "./bot";
import { parseAllowlist } from "./handlers";
import { startScheduler } from "./scheduler";
import { log } from "./log";

const token = process.env.TELEGRAM_BOT_TOKEN;
const mode = process.env.TELEGRAM_MODE ?? "webhook";
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL; // e.g. https://finance.example.com/api/v1/webhooks/telegram
const port = Number(process.env.BOT_PORT ?? 8081);
const WEBHOOK_PATH = "/api/v1/webhooks/telegram";

async function main() {
  await connectDB();
  await ensureSetup();
  const allow = parseAllowlist();

  if (!token) {
    log("error", "TELEGRAM_BOT_TOKEN missing; bot disabled (health endpoint still served)");
  } else if (!allow.size) {
    log("error", "TELEGRAM_ALLOWED_USER_IDS is empty; refusing to start an open bot");
  }
  const bot = token && allow.size ? createBot(token, allow) : null;
  if (bot) await bot.init();

  const handleUpdate = bot && mode === "webhook" ? (secret ? webhookCallback(bot, "http", { secretToken: secret, onTimeout: "return", timeoutMilliseconds: 55_000 }) : null) : null;
  if (bot && mode === "webhook" && !secret) log("error", "TELEGRAM_WEBHOOK_SECRET missing; webhook disabled");

  createServer(async (req, res) => {
    if (req.url === "/healthz") {
      const dbOk = mongoose.connection.readyState === 1;
      res.writeHead(dbOk ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok: dbOk, bot: Boolean(bot), mode }));
      return;
    }
    if (req.method === "POST" && req.url === WEBHOOK_PATH && handleUpdate) return handleUpdate(req, res);
    res.writeHead(404).end();
  }).listen(port, () => log("info", "bot_http_listening", { port, mode }));

  if (bot) {
    const send = (chatId: number, text: string) => bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    startScheduler(send);
    await bot.api.setMyCommands([
      { command: "balance", description: "Balances by account" },
      { command: "today", description: "Today's summary" },
      { command: "week", description: "Last 7 days" },
      { command: "month", description: "This month" },
      { command: "recent", description: "Recent transactions" },
      { command: "search", description: "Search transactions" },
      { command: "budget", description: "Budget status / set budget" },
      { command: "report", description: "Weekly report now (or: /report month)" },
      { command: "undo", description: "Reverse last transaction" },
      { command: "fix", description: "Correct last transaction" },
      { command: "accounts", description: "Accounts & default" },
      { command: "categories", description: "Category list" },
      { command: "help", description: "How to use" },
    ]);
    if (mode === "polling") {
      await bot.api.deleteWebhook();
      bot.start({ allowed_updates: ["message", "edited_message"], onStart: () => log("info", "bot_polling_started") });
    } else if (webhookUrl && secret) {
      await bot.api.setWebhook(webhookUrl, { secret_token: secret, allowed_updates: ["message", "edited_message"] });
      log("info", "webhook_registered", { url: webhookUrl.replace(/\/\/([^/]+)/, "//$1") });
    }
  }
}

main().catch((e) => {
  log("error", "fatal", { error: String(e) });
  process.exit(1);
});
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => mongoose.disconnect().finally(() => process.exit(0)));
