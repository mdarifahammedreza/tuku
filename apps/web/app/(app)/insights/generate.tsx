"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { api } from "@/lib/utils";

export function GenerateButtons({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function run(type: string) {
    setBusy(type);
    setError("");
    try {
      await api("/api/v1/insights/generate", { method: "POST", body: JSON.stringify({ type }) });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {[["weekly", "This week"], ["monthly", "This month"], ["last_month", "Last month"]].map(([t, l]) => (
          <Button key={t} variant="outline" size="sm" disabled={!enabled || !!busy} onClick={() => run(t)}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy === t ? "animate-spin" : ""}`} /> {l}
          </Button>
        ))}
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
