"use client";
import { useState } from "react";
import { Lock, Wallet } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui";
import { api } from "@/lib/utils";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg"><Wallet className="h-4 w-4" /></div>
          <div>
            <div className="font-semibold">Taka Ledger</div>
            <div className="text-xs text-muted">Private finance dashboard</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="pw">Password</Label>
            <Input id="pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <Button className="w-full" disabled={busy || !password}><Lock className="h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </Card>
    </div>
  );
}
