// Claude financial analyst. Receives only deterministic, pre-aggregated figures (never raw history).
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You are a concise personal financial analyst for a single user in Bangladesh. Currency is BDT (৳). Timezone Asia/Dhaka.

Rules:
- Use ONLY the figures in the provided JSON. Never invent transactions, balances or comparisons. If data is missing, say so.
- All money values in the JSON are already in taka. Write amounts like ৳1,250.
- Label anything that is not directly in the data as an estimate.
- Accounting meaning: transfers, savings transfers, investments and loan principal are NOT expenses; loans received are NOT income; "receivables" is money others owe the user; "payables" is money the user owes.
- Be practical and specific to the categories and items in the data. Realistic targets, no shaming.
- Do not recommend risky investments; if you mention any investment, state its risks.
- Output plain text for Telegram: short headings in CAPS, "•" bullets, no markdown tables, no ** or #.`;

const WEEKLY_TASK = `Write a SHORT weekly note (max ~120 words) with two headings:
OBSERVATIONS — 2-4 bullets (biggest category, change vs previous 7 days, repeated small purchases, anything unusual).
SUGGESTIONS — 2-3 concrete bullets for next week.`;

const MONTHLY_TASK = `Write the monthly advice (max ~450 words) with these headings, in order:
SUMMARY — 2-3 sentence executive summary (income, spending, actual remaining balance, savings rate).
VS LAST MONTH — key changes with numbers from the data.
TOP CATEGORIES — top five with amounts and share.
UNUSUAL PATTERNS — repeated small expenses, spikes, budget overruns.
3 MISTAKES TO ADDRESS
3 IMPROVEMENTS
NEXT MONTH BUDGET — category budgets (taka) that add up to a total, based on actual spending and income.
SAVINGS TARGET — one realistic number with reasoning, considering outstanding loans and essential costs.
ACTION PLAN — 3-5 short steps for next month.`;

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | undefined;

export async function analyze(kind: "weekly" | "monthly", data: unknown): Promise<string> {
  if (!aiEnabled()) throw new Error("ANTHROPIC_API_KEY not configured");
  client ??= new Anthropic({ maxRetries: 3, timeout: 120_000 });
  const response = await client.beta.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: kind === "monthly" ? 8000 : 3000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: kind === "monthly" ? "medium" : "low" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${kind === "monthly" ? MONTHLY_TASK : WEEKLY_TASK}\n\nDATA (JSON):\n${JSON.stringify(data)}` }],
  } as any);
  if (response.stop_reason === "refusal") throw new Error("Claude declined to analyse this report");
  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error(`Empty analysis (stop_reason=${response.stop_reason})`);
  return text;
}

export function describeAIError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API key is invalid";
  if (err instanceof Anthropic.RateLimitError) return "Claude API rate limited";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`.slice(0, 300);
  return err instanceof Error ? err.message.slice(0, 300) : String(err);
}
