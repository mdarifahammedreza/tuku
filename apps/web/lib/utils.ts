import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
export { formatBDT } from "@finance/core/money";
export { categoryLabel, CATEGORIES } from "@finance/core/categories";

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)"];

/** Compact axis labels: ৳12k, ৳1.2M (input in poisha). */
export function compactBDT(p: number) {
  const t = p / 100;
  const a = Math.abs(t);
  if (a >= 1e6) return `৳${(t / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `৳${Math.round(t / 1e3)}k`;
  return `৳${Math.round(t)}`;
}

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({ ok: false, error: { message: res.statusText } }));
  if (!body.ok) {
    if (res.status === 401) window.location.href = "/login";
    const details = body.error?.details?.map?.((d: any) => `${d.path}: ${d.message}`).join("; ");
    throw new Error(details ? `${body.error.message} — ${details}` : (body.error?.message ?? "Request failed"));
  }
  return body.data as T;
}

export const TYPE_LABEL: Record<string, string> = {
  income: "Income", expense: "Expense", transfer: "Transfer", loan_given: "Loan given", loan_received: "Loan received",
  loan_repayment: "Repayment", savings: "Savings", investment: "Investment", refund: "Refund",
};
