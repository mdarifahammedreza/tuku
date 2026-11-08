// All money is stored as integer poisha (1 BDT = 100 poisha) to avoid float errors.
export type Poisha = number;

export function toPoisha(taka: number | string): Poisha {
  const n = typeof taka === "string" ? Number(taka) : taka;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${taka}`);
  const p = Math.round(n * 100);
  if (!Number.isSafeInteger(p)) throw new Error(`Amount out of range: ${taka}`);
  return p;
}

export function toTaka(p: Poisha): number {
  return p / 100;
}

/** ৳1,234 or ৳1,234.50 (Bangladeshi grouping is not used; standard grouping is clearer in charts). */
export function formatBDT(p: Poisha, opts: { sign?: boolean } = {}): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const s = whole.toLocaleString("en-US") + (frac ? "." + String(frac).padStart(2, "0") : "");
  const prefix = neg ? "-" : opts.sign && p > 0 ? "+" : "";
  return `${prefix}৳${s}`;
}
