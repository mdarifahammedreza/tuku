# Taka Ledger — personal finance bot

Record income and expenses by texting a Telegram bot (`alu 30`, `salary 40000`), see everything on a Next.js dashboard, let Claude query your finances over MCP, and get automatic daily / weekly / monthly reports.

Currency BDT (stored as integer poisha), timezone Asia/Dhaka (timestamps stored in UTC).

```
apps/web            Next.js dashboard + REST API (/api/v1)
services/bot        Telegram bot (grammY) + report scheduler (node-cron)
services/mcp        MCP server (Streamable HTTP + stdio)
packages/core       Shared: parser, ledger math, Mongoose models, services, reports, Claude advisor
scripts/            backup.sh, restore.sh, demo-db.ts
infrastructure/     Cloudflare Tunnel config example
```

## Quick start (Docker)

```bash
cp .env.example .env      # fill in the values (see below)
docker compose up -d --build
docker compose ps         # all services should be "healthy"
```

Dashboard: http://127.0.0.1:3100 (password = `DASHBOARD_PASSWORD`).
MongoDB is only reachable inside the Docker network; no port is published.

### Required `.env` values

| Variable | How to get it |
|---|---|
| `MONGO_USER`, `MONGO_PASSWORD` | any; password: `openssl rand -hex 24` |
| `DASHBOARD_PASSWORD` | your choice, min 10 chars |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | @BotFather → /newbot |
| `TELEGRAM_ALLOWED_USER_IDS` | your numeric Telegram id (@userinfobot). Bot refuses to start if empty |
| `TELEGRAM_MODE` | `polling` (no tunnel needed) or `webhook` (production behind the tunnel) |
| `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_URL` | webhook mode only: `openssl rand -hex 32`, `https://<your-domain>/api/v1/webhooks/telegram` |
| `MCP_AUTH_TOKEN` | `openssl rand -hex 32` (HTTP MCP only) |
| `ANTHROPIC_API_KEY` | optional; enables Claude analysis in reports. `ANTHROPIC_MODEL` defaults to `claude-opus-5-5` |
| `CLOUDFLARE_TUNNEL_TOKEN` | optional; see Cloudflare Tunnel |

After changing `.env`: `docker compose up -d` (recreates the changed services).

## Telegram

Send `/start` once; that chat receives the scheduled reports.

Type one transaction per line. English, Banglish and Bangla script/digits work:

```
alu:30 tk            poratha 30 taka       rickshaw 40 bkash
salary 40000 bank    received 500 refund   paid 10000 rent
gave Amit 2000 loan  Amit paid back 500    borrowed 5000 from Karim
saved 3000           invested 10000 in sanchaypatra
transfer 5000 from bank to bkash           paid credit card bill 8000 from bank
dinner 300 yesterday
```

Rules: if any line is unclear (no amount, two numbers, "loan 2000" without direction), **nothing** from that message is saved and the bot asks you to fix it. A Telegram update delivered twice is saved once (unique chat id + message id + line). Unknown items are saved as category "Other"; fix with `/fix category food`.

Commands: `/balance /today /week /month /recent /search <text> /budget [category amount] /report [month] /undo /fix <amount|category x|desc x|account x> /accounts /addaccount <type> <name> [opening] /setdefault <account> /opening <account> <amount> /categories /help`. Reply to a bot confirmation with `/fix` or `/undo` to target that message.

Custom keywords per category: Settings → Custom category keywords.

## Accounting rules (packages/core/src/ledger.ts)

| Type | Account effect | Counted as |
|---|---|---|
| income | + | income |
| expense | − | expense |
| refund | + | reduces expense of its category |
| transfer / savings / investment | − source, + destination (if any) | neither (savings/investment tracked separately) |
| loan_given | − | receivable (not expense) |
| loan_received | + | payable (not income) |
| loan_repayment (receivable) | + | reduces receivable; interest part = income |
| loan_repayment (payable) | − | reduces payable; interest part = expense |

A credit card is an account: purchases are expenses on the card, the bill payment is a transfer, so nothing is counted twice. Balance = opening balance + effects. Reversed transactions stay in history but are excluded from totals; every create/correct/reverse/budget/account change is written to `auditlogs`.

## Reports

Run by the bot service (Asia/Dhaka): daily balance 22:00, weekly Sunday 21:00 (previous 7 days), monthly 1st 09:00 (previous month). Each period is one document in `reports` (unique type + period) that also acts as the job record: a lock prevents duplicate sends, multi-part messages resume where they stopped, "delivered" is written only after Telegram accepted every part, failed runs retry every 15 minutes (max 5 attempts) and missed runs are caught up after restarts. Toggle each report in Settings.

Claude gets only pre-aggregated figures (no raw history), and the analysis is cached: it is regenerated only when the period's numbers change. Without `ANTHROPIC_API_KEY` reports are sent without the AI section. Manual generation: AI Insights page or `/report`.

## Claude via MCP

Tools — read: `get_financial_overview, get_transactions, get_expense_summary, get_daily_expenses, get_weekly_report, get_monthly_report, get_category_trends, get_budget_status, get_remaining_balance, get_top_expenses, get_loan_summary, get_savings_progress`; mutations: `correct_transaction, reverse_transaction, set_monthly_budget, create_savings_goal`. Resources: `finance://profile`, `finance://accounts`, `finance://current-month`, `finance://current-budgets`. All amounts are in taka.

Mutations are two-step: the first call returns a preview and a one-time `confirm_token` (10 min); the change runs only when called again with the same arguments plus the token, after you confirm. There is no raw-query tool.

**Claude Desktop on this machine (stdio, no token needed)** — `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "personal-finance": {
      "command": "/usr/bin/docker",
      "args": ["compose", "-f", "/home/arise/AREA-51/finace-bot/docker-compose.yml", "exec", "-T", "mcp", "node", "--import", "tsx", "src/stdio.ts"]
    }
  }
}
```

**Claude Code / remote clients (Streamable HTTP + bearer token)**:

```bash
claude mcp add --transport http finance https://mcp.example.com/mcp --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

Locally the HTTP endpoint is `http://127.0.0.1:8082/mcp`. It is stateless (POST only), rate limited (120/min/IP) and rejects browser origins not in `MCP_ALLOWED_ORIGINS`.

## Cloudflare Tunnel

Only needed to reach the dashboard / webhook / MCP from outside this machine.

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → create tunnel, copy the token into `CLOUDFLARE_TUNNEL_TOKEN`.
2. Public hostnames (cloudflared uses host networking): `tuku.<domain>` → `http://localhost:3100` (dashboard + webhook); `tuku-api.<domain>` → `http://localhost:8082` (MCP). Do not add MongoDB. Other local services can share the tunnel, e.g. Frigate: `cctv.<domain>` → `https://localhost:8971` with "No TLS Verify" (port 8971 requires login; never expose Frigate's unauthenticated port 5000).
3. `docker compose --profile tunnel up -d`
4. For Telegram webhooks set `TELEGRAM_MODE=webhook`, `TELEGRAM_WEBHOOK_URL=https://tuku.<domain>/api/v1/webhooks/telegram`, then `docker compose up -d`. The web app forwards that path to the bot, which checks the secret header.

Locally-managed alternative: `infrastructure/cloudflare/config.example.yml`. Optionally add Cloudflare Access in front of the dashboard hostname (not the webhook or MCP hostnames).

## Backups

```bash
scripts/backup.sh                                   # backups/finance-<timestamp>.archive.gz, keeps last 30
scripts/restore.sh backups/finance-<timestamp>.archive.gz   # asks for confirmation, backs up first
```

Daily cron: `0 3 * * * cd /home/arise/AREA-51/finace-bot && scripts/backup.sh >> backups/backup.log 2>&1`. Copy `backups/` off the machine regularly.

## REST API (`/api/v1`)

All endpoints need the session cookie (POST `/auth/login` with `{password}`); mutations must be same-origin. Responses: `{ok: true, data}` or `{ok: false, error: {message, details?}}`. **Request amounts are taka; response amounts are integer poisha.**

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login`, `/auth/logout` | login: 5 attempts/min/IP |
| GET | `/dashboard/overview` | balances, month summary, categories, daily series, recent, loans, budgets |
| GET | `/dashboard/analytics?months=6` | monthly series, daily, this vs last month |
| GET | `/transactions` | `q, type, category, accountId, from, to, status=confirmed\|reversed\|all, page, pageSize`; `format=csv` for export |
| POST | `/transactions` | `{type, amount, description, category?, accountId?, toAccountId?, counterparty?, loanKind?, interestAmount?, transactionDate?}` |
| GET/PATCH | `/transactions/:id` | PATCH any subset of the fields above |
| POST | `/transactions/:id/reverse` | `{reason}` |
| GET/POST | `/accounts` | `{name, type, openingBalance}` |
| PATCH | `/accounts/:id` | `{name?, openingBalance?, isActive?}` |
| GET/POST | `/budgets` | GET `?year&month` → status + history; POST `{year, month, category\|"total", allocatedAmount}` |
| PATCH | `/budgets/:id` | `{allocatedAmount}` |
| GET | `/reports`, `/reports/weekly`, `/reports/monthly?year&month` | |
| GET | `/insights`; POST `/insights/generate` | `{type: weekly\|monthly\|last_month}` (10/hour) |
| GET/PATCH | `/profile`; GET/POST `/goals` | |
| POST | `/webhooks/telegram` | forwarded to the bot |
| GET | `/api/health` | |

## Development

```bash
pnpm install
pnpm test                 # 66 tests: parser, ledger, DB idempotency, reports/scheduler, bot, MCP (uses in-memory MongoDB)
pnpm typecheck
pnpm tsx scripts/demo-db.ts   # throwaway in-memory DB with demo data on :27099 (never touches real data)
```

Run services outside Docker with `MONGODB_URI` pointing at a MongoDB you start yourself: `pnpm dev:web` (port 3100), `pnpm dev:bot` (use `TELEGRAM_MODE=polling`), `pnpm dev:mcp`.

## Security notes

Dashboard: password login, HS256 session cookie (HttpOnly, Secure in production, SameSite=Lax), origin check on mutations, per-IP rate limits, security headers. Telegram: user-id allowlist, webhook secret token. MCP: separate hostname and bearer token (constant-time compare), no arbitrary queries, two-step confirmation for writes. Logs are structured JSON and never include message text or secrets. Keep `.env` private (it is git-ignored).

## Assumptions

- Single user; data model has no user id yet (add one to every collection to go multi-user).
- Asia/Dhaka is treated as fixed UTC+6 (Bangladesh has no DST).
- A plain "item amount" line is an expense by convention; anything ambiguous is rejected, never guessed.
- Multi-line Telegram messages are all-or-nothing.
