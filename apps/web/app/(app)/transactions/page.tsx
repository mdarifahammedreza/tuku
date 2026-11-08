"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Search, Undo2 } from "lucide-react";
import { Badge, Button, Card, Dialog, Empty, Input, Label, PageHeader, Select } from "@/components/ui";
import { api, CATEGORIES, categoryLabel, cn, formatBDT, TYPE_LABEL } from "@/lib/utils";

type Tx = { id: string; type: string; amount: number; description: string; category: string; accountId: string; toAccountId?: string; transactionDate: string; status: string; source: string; counterparty?: string; loanKind?: string; notes?: string };
type Account = { id: string; name: string; type: string; isActive: boolean };

const TYPES = Object.keys(TYPE_LABEL);
const isInflow = (t: Tx) => ["income", "refund", "loan_received"].includes(t.type) || (t.type === "loan_repayment" && t.loanKind === "receivable");
const dhakaDate = (iso: string) => new Date(new Date(iso).getTime() + 6 * 3600e3).toISOString().slice(0, 10);
const fromDhakaDate = (d: string) => new Date(`${d}T12:00:00+06:00`).toISOString();

export default function TransactionsPage() {
  const [filters, setFilters] = useState({ q: "", type: "", category: "", accountId: "", from: "", to: "", status: "confirmed" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Tx[]; total: number; pages: number } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Tx | "new" | null>(null);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      if (k === "from") p.set(k, new Date(`${v}T00:00:00+06:00`).toISOString());
      else if (k === "to") p.set(k, new Date(new Date(`${v}T00:00:00+06:00`).getTime() + 86400e3).toISOString());
      else p.set(k, v);
    }
    return p;
  }, [filters]);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/v1/transactions?${params}&page=${page}&pageSize=25`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [params, page]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    api<Account[]>("/api/v1/accounts").then(setAccounts).catch(() => {});
  }, []);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };
  const accName = (id?: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  async function reverse(t: Tx) {
    const reason = prompt(`Reverse "${t.description}" ${formatBDT(t.amount)}?\nIt stays in history but is excluded from totals.\n\nReason:`, "Entered by mistake");
    if (!reason) return;
    try {
      await api(`/api/v1/transactions/${t.id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description={data ? `${data.total} transaction${data.total === 1 ? "" : "s"}` : "Loading…"}
        action={
          <div className="flex gap-2">
            <a href={`/api/v1/transactions?${params}&format=csv`}><Button variant="outline"><Download className="h-4 w-4" /> CSV</Button></a>
            <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add</Button>
          </div>
        }
      />
      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <div className="relative col-span-2 md:col-span-3 xl:col-span-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <Input placeholder="Search description" className="pl-8" value={filters.q} onChange={set("q")} />
          </div>
          <Select value={filters.type} onChange={set("type")} aria-label="Type">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
          <Select value={filters.category} onChange={set("category")} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <Select value={filters.accountId} onChange={set("accountId")} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Input type="date" aria-label="From" value={filters.from} onChange={set("from")} />
          <Input type="date" aria-label="To" value={filters.to} onChange={set("to")} />
        </div>
        <label className="mt-2 flex items-center gap-2 px-1 text-xs text-fg-2">
          <input type="checkbox" checked={filters.status === "all"} onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, status: e.target.checked ? "all" : "confirmed" })); }} />
          Show reversed
        </label>
      </Card>

      {error && <p className="mb-3 text-sm text-bad">{error}</p>}

      <Card className="overflow-hidden">
        {data && !data.items.length ? (
          <div className="p-5"><Empty>No transactions match these filters</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-fg-2">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Category</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Account</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="w-20 px-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.items.map((t) => (
                  <tr key={t.id} className={cn("hover:bg-surface-2/50", t.status === "reversed" && "opacity-50")}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-fg-2 tabular-nums">{dhakaDate(t.transactionDate).slice(5).replace("-", "/")}</td>
                    <td className="px-4 py-2.5">
                      <div className={cn("font-medium", t.status === "reversed" && "line-through")}>{t.description}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {t.type !== "expense" && <Badge tone={isInflow(t) ? "good" : "neutral"}>{TYPE_LABEL[t.type]}</Badge>}
                        {t.status === "reversed" && <Badge tone="bad">Reversed</Badge>}
                        <span className="text-xs text-muted sm:hidden">{categoryLabel(t.category)}</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-fg-2 sm:table-cell">{categoryLabel(t.category)}</td>
                    <td className="hidden px-4 py-2.5 text-fg-2 md:table-cell">{accName(t.accountId)}{t.toAccountId ? ` → ${accName(t.toAccountId)}` : ""}</td>
                    <td className={cn("whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums", isInflow(t) && "text-good")}>{isInflow(t) ? "+" : ""}{formatBDT(t.amount)}</td>
                    <td className="px-2 py-2.5">
                      {t.status === "confirmed" && (
                        <div className="flex justify-end">
                          <button aria-label="Edit" onClick={() => setEditing(t)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><Pencil className="h-3.5 w-3.5" /></button>
                          <button aria-label="Reverse" onClick={() => reverse(t)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-bad"><Undo2 className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-fg-2">
            <span>Page {page} of {data.pages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>

      {editing && <TxForm tx={editing === "new" ? null : editing} accounts={accounts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function TxForm({ tx, accounts, onClose, onSaved }: { tx: Tx | null; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    type: tx?.type ?? "expense",
    amount: tx ? String(tx.amount / 100) : "",
    description: tx?.description ?? "",
    category: tx?.category ?? "other",
    accountId: tx?.accountId ?? accounts.find((a) => a.type === "cash")?.id ?? "",
    toAccountId: tx?.toAccountId ?? "",
    counterparty: tx?.counterparty ?? "",
    loanKind: tx?.loanKind ?? "payable",
    date: tx ? dhakaDate(tx.transactionDate) : dhakaDate(new Date().toISOString()),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const needsTo = ["transfer", "savings", "investment"].includes(f.type);
  const isLoan = f.type.startsWith("loan");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      type: f.type, amount: Number(f.amount), description: f.description, category: f.category, accountId: f.accountId,
      transactionDate: tx && f.date === dhakaDate(tx.transactionDate) ? undefined : fromDhakaDate(f.date),
    };
    if (needsTo) body.toAccountId = f.toAccountId || (tx ? null : undefined);
    if (isLoan) body.counterparty = f.counterparty;
    if (f.type === "loan_repayment") body.loanKind = f.loanKind;
    for (const k of Object.keys(body)) if (body[k] === undefined || body[k] === "") delete body[k];
    try {
      if (tx) await api(`/api/v1/transactions/${tx.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/v1/transactions", { method: "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={tx ? "Edit transaction" : "Add transaction"}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Type</Label><Select value={f.type} onChange={set("type")}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select></div>
          <div><Label>Amount (৳)</Label><Input inputMode="decimal" required value={f.amount} onChange={set("amount")} /></div>
        </div>
        <div><Label>Description</Label><Input required maxLength={200} value={f.description} onChange={set("description")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Category</Label><Select value={f.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
          <div><Label>Date</Label><Input type="date" required value={f.date} onChange={set("date")} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{needsTo ? "From account" : "Account"}</Label><Select value={f.accountId} onChange={set("accountId")}>{accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
          {needsTo && <div><Label>To account</Label><Select value={f.toAccountId} onChange={set("toAccountId")}><option value="">{f.type === "transfer" ? "Select…" : "None (external)"}</option>{accounts.filter((a) => a.isActive && a.id !== f.accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>}
          {isLoan && <div><Label>Person</Label><Input value={f.counterparty} onChange={set("counterparty")} /></div>}
        </div>
        {f.type === "loan_repayment" && (
          <div><Label>Repayment of</Label><Select value={f.loanKind} onChange={set("loanKind")}><option value="payable">A loan I took (I paid)</option><option value="receivable">A loan I gave (I received)</option></Select></div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
