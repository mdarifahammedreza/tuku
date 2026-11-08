"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, PageHeader, Select } from "@/components/ui";
import { api, CATEGORIES, cn, formatBDT } from "@/lib/utils";

type Account = { id: string; name: string; type: string; openingBalance: number; balance: number | null; isActive: boolean };
type Profile = { monthlySalary: number; emergencyFundTarget: number; defaultAccountId?: string; reporting?: { chatId?: number; daily?: boolean; weekly?: boolean; monthly?: boolean }; categoryKeywords?: Record<string, string[]>; goals: { id: string; name: string; targetAmount: number; deadline?: string }[] };

const ACCOUNT_TYPES = ["cash", "bank", "bkash", "nagad", "rocket", "credit_card", "savings", "investment", "other"];

function useSaved() {
  const [msg, setMsg] = useState("");
  return { msg, flash: (m = "Saved") => { setMsg(m); setTimeout(() => setMsg(""), 2000); } };
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([api<Profile>("/api/v1/profile"), api<Account[]>("/api/v1/accounts")]);
      setProfile(p);
      setAccounts(a);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!profile) return <PageHeader title="Settings" description={error || "Loading…"} />;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard profile={profile} accounts={accounts} onSaved={load} />
        <ReportingCard profile={profile} onSaved={load} />
        <AccountsCard accounts={accounts} defaultId={profile.defaultAccountId} onSaved={load} />
        <GoalsCard profile={profile} accounts={accounts} onSaved={load} />
        <KeywordsCard profile={profile} onSaved={load} />
      </div>
    </>
  );
}

function ProfileCard({ profile, accounts, onSaved }: { profile: Profile; accounts: Account[]; onSaved: () => void }) {
  const [f, setF] = useState({ monthlySalary: String(profile.monthlySalary / 100), emergencyFundTarget: String(profile.emergencyFundTarget / 100), defaultAccountId: profile.defaultAccountId ?? "" });
  const [error, setError] = useState("");
  const s = useSaved();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/profile", { method: "PATCH", body: JSON.stringify({ monthlySalary: Number(f.monthlySalary), emergencyFundTarget: Number(f.emergencyFundTarget), ...(f.defaultAccountId && { defaultAccountId: f.defaultAccountId }) }) });
      s.flash();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Card>
      <CardHeader title="Financial profile" description="Used for reports and Claude's advice" />
      <CardBody>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Monthly salary (৳)</Label><Input inputMode="decimal" value={f.monthlySalary} onChange={(e) => setF({ ...f, monthlySalary: e.target.value })} /></div>
            <div><Label>Emergency fund target (৳)</Label><Input inputMode="decimal" value={f.emergencyFundTarget} onChange={(e) => setF({ ...f, emergencyFundTarget: e.target.value })} /></div>
          </div>
          <div>
            <Label>Default payment account</Label>
            <Select value={f.defaultAccountId} onChange={(e) => setF({ ...f, defaultAccountId: e.target.value })}>{accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            <p className="mt-1 text-xs text-muted">Telegram entries without an account (e.g. “alu 30”) go here.</p>
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <SaveRow msg={s.msg} />
        </form>
      </CardBody>
    </Card>
  );
}

function SaveRow({ msg, label = "Save" }: { msg: string; label?: string }) {
  return (
    <div className="flex items-center justify-end gap-3 pt-1">
      {msg && <span className="flex items-center gap-1 text-xs text-good"><Check className="h-3.5 w-3.5" /> {msg}</span>}
      <Button>{label}</Button>
    </div>
  );
}

function ReportingCard({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const r = profile.reporting ?? {};
  const toggle = async (k: "daily" | "weekly" | "monthly") => {
    await api("/api/v1/profile", { method: "PATCH", body: JSON.stringify({ reporting: { [k]: !(r[k] ?? true) } }) });
    onSaved();
  };
  const rows = [
    { k: "daily" as const, title: "Daily balance", when: "Every day, 10:00 PM" },
    { k: "weekly" as const, title: "Weekly report + Claude notes", when: "Sunday, 9:00 PM" },
    { k: "monthly" as const, title: "Monthly report + Claude advice", when: "1st of month, 9:00 AM" },
  ];
  return (
    <Card>
      <CardHeader title="Telegram & reports" description="Times are Asia/Dhaka" />
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span className="text-fg-2">Report chat</span>
          {r.chatId ? <Badge tone="good">Connected</Badge> : <Badge tone="warn">Send /start to your bot</Badge>}
        </div>
        {rows.map((row) => {
          const on = r[row.k] ?? true;
          return (
            <div key={row.k} className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">{row.title}</div><div className="text-xs text-muted">{row.when}</div></div>
              <button role="switch" aria-checked={on} aria-label={row.title} onClick={() => toggle(row.k)} className={cn("relative h-5 w-9 rounded-full transition", on ? "bg-accent" : "bg-border")}>
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-4.5" : "left-0.5")} />
              </button>
            </div>
          );
        })}
        <p className="text-xs text-muted">Bot token, allowed Telegram user IDs and the webhook secret are set in the server's <code>.env</code> file.</p>
      </CardBody>
    </Card>
  );
}

function AccountsCard({ accounts, defaultId, onSaved }: { accounts: Account[]; defaultId?: string; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", type: "bkash", openingBalance: "0" });
  const [error, setError] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/accounts", { method: "POST", body: JSON.stringify({ name: f.name, type: f.type, openingBalance: Number(f.openingBalance) }) });
      setF({ name: "", type: "bkash", openingBalance: "0" });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const patch = async (a: Account, body: object) => {
    try {
      await api(`/api/v1/accounts/${a.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved();
    } catch (err) {
      alert((err as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader title="Accounts" description="Opening balance + ledger = current balance" />
      <CardBody>
        <ul className="mb-4 divide-y divide-border">
          {accounts.map((a) => (
            <li key={a.id} className={cn("flex items-center gap-2 py-2.5 text-sm", !a.isActive && "opacity-50")}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{a.name} {a.id === defaultId && <Badge tone="accent">default</Badge>}</div>
                <div className="text-xs text-muted">{a.type} · opening {formatBDT(a.openingBalance)}</div>
              </div>
              <span className="font-medium tabular-nums">{a.balance === null ? "—" : formatBDT(a.balance)}</span>
              <Button size="sm" variant="ghost" onClick={() => { const v = prompt(`Opening balance for ${a.name} (৳):`, String(a.openingBalance / 100)); if (v !== null && v.trim() !== "") patch(a, { openingBalance: Number(v) }); }}>Opening</Button>
              {a.id !== defaultId && <Button size="sm" variant="ghost" onClick={() => patch(a, { isActive: !a.isActive })}>{a.isActive ? "Archive" : "Restore"}</Button>}
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <Input placeholder="Account name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="col-span-2 sm:col-span-1" />
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Account type">{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          <Input inputMode="decimal" aria-label="Opening balance" className="sm:w-28" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} />
          <Button className="col-span-2 sm:col-span-1"><Plus className="h-4 w-4" /> Add</Button>
        </form>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </CardBody>
    </Card>
  );
}

function GoalsCard({ profile, accounts, onSaved }: { profile: Profile; accounts: Account[]; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", targetAmount: "", accountId: "", deadline: "" });
  const [error, setError] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/goals", { method: "POST", body: JSON.stringify({ name: f.name, targetAmount: Number(f.targetAmount), ...(f.accountId && { accountId: f.accountId }), ...(f.deadline && { deadline: `${f.deadline}T00:00:00+06:00` }) }) });
      setF({ name: "", targetAmount: "", accountId: "", deadline: "" });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader title="Financial goals" description="Progress uses a linked account's balance, or savings transfers since the goal was created" />
      <CardBody>
        <ul className="mb-4 space-y-1.5 text-sm">
          {profile.goals.map((g) => <li key={g.id} className="flex justify-between"><span>{g.name}</span><span className="tabular-nums text-fg-2">{formatBDT(g.targetAmount)}</span></li>)}
          {!profile.goals.length && <li className="text-muted">No goals yet</li>}
        </ul>
        <form onSubmit={add} className="grid grid-cols-2 gap-2">
          <Input placeholder="Goal (e.g. Laptop)" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="Target ৳" inputMode="decimal" required value={f.targetAmount} onChange={(e) => setF({ ...f, targetAmount: e.target.value })} />
          <Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })} aria-label="Linked account"><option value="">No linked account</option>{accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Input type="date" aria-label="Deadline" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
          <Button className="col-span-2"><Plus className="h-4 w-4" /> Add goal</Button>
        </form>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </CardBody>
    </Card>
  );
}

function KeywordsCard({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const kw = profile.categoryKeywords ?? {};
  const [cat, setCat] = useState("food");
  const [words, setWords] = useState((kw.food ?? []).join(", "));
  const s = useSaved();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = words.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
    await api("/api/v1/profile", { method: "PATCH", body: JSON.stringify({ categoryKeywords: { ...kw, [cat]: list } }) });
    s.flash();
    onSaved();
  };
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Custom category keywords" description="Extra words the Telegram parser maps to a category (built-in words still apply)" />
      <CardBody>
        <form onSubmit={save} className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
          <Select value={cat} onChange={(e) => { setCat(e.target.value); setWords((kw[e.target.value] ?? []).join(", ")); }} aria-label="Category">
            {CATEGORIES.filter((c) => c.kind !== "other").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <Input placeholder="e.g. kacchi, sharma, starbucks" value={words} onChange={(e) => setWords(e.target.value)} />
          <SaveRow msg={s.msg} />
        </form>
      </CardBody>
    </Card>
  );
}
