import { categoryLabel, createTransaction, dayKey, listAccounts, listTransactions, toTaka, transactionFilters, transactionInput } from "@finance/core";
import { ok, query, route } from "@/lib/api";

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // prevent spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const GET = route(async (req) => {
  const q = query(req);
  if (q.format === "csv") {
    const f = transactionFilters.parse({ ...q, page: 1, pageSize: 200 });
    const accounts = new Map((await listAccounts(true)).map((a) => [a._id.toString(), a.name]));
    const rows = [["date", "type", "description", "category", "amount_bdt", "account", "to_account", "counterparty", "status", "source", "id"]];
    for (let page = 1; ; page++) {
      const r = await listTransactions({ ...f, page });
      for (const t of r.items)
        rows.push([dayKey(t.transactionDate), t.type, t.description, categoryLabel(t.category), String(toTaka(t.amount)), accounts.get(String(t.accountId)) ?? "", t.toAccountId ? (accounts.get(String(t.toAccountId)) ?? "") : "", t.counterparty ?? "", t.status, t.source, t._id.toString()]);
      if (page >= r.pages || page >= 500) break;
    }
    return new Response(rows.map((r) => r.map(csvCell).join(",")).join("\n"), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="transactions-${dayKey(new Date())}.csv"` },
    });
  }
  return ok(await listTransactions(transactionFilters.parse(q)));
});

export const POST = route(async (req) => ok(await createTransaction(transactionInput.parse(await req.json()), "web"), 201));
