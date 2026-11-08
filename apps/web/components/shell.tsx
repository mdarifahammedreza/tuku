"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowLeftRight, BarChart3, LayoutDashboard, LogOut, Moon, PiggyBank, Settings, Sparkles, Sun, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/insights", label: "AI Insights", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} className="rounded-lg p-2 text-fg-2 hover:bg-surface-2">
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </button>
  );
}

async function logout() {
  await fetch("/api/v1/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg"><Wallet className="h-4 w-4" /></div>
          <span className="font-semibold tracking-tight">Taka Ledger</span>
        </div>
        <nav className="flex-1 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition", active(href) ? "bg-surface-2 font-medium text-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}>
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-between border-t border-border px-1 pt-3">
          <ThemeToggle />
          <button onClick={logout} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-fg-2 hover:bg-surface-2"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg"><Wallet className="h-3.5 w-3.5" /></div><span className="font-semibold">Taka Ledger</span></div>
        <div className="flex items-center"><ThemeToggle /><button aria-label="Sign out" onClick={logout} className="rounded-lg p-2 text-fg-2"><LogOut className="h-4 w-4" /></button></div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-surface/95 backdrop-blur md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[10px]", active(href) ? "text-accent" : "text-muted")}>
            <Icon className="h-5 w-5" /> {label.split(" ")[0]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
