// Forwards Telegram updates to the bot service, which verifies the secret token itself.
const BOT_URL = process.env.BOT_INTERNAL_URL ?? "http://bot:8081";

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret) return new Response("Unauthorized", { status: 401 });
  const body = await req.text();
  if (body.length > 1_000_000) return new Response("Too large", { status: 413 });
  try {
    const r = await fetch(`${BOT_URL}/api/v1/webhooks/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body,
      signal: AbortSignal.timeout(58_000),
    });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "text/plain" } });
  } catch {
    return new Response("Bot unavailable", { status: 502 });
  }
}
