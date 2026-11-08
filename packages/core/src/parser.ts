import { toPoisha, type Poisha } from "./money";
import { categoryLabel, detectCategory, hasKeyword, type KeywordOverrides } from "./categories";

export const TX_TYPES = ["income", "expense", "transfer", "loan_given", "loan_received", "loan_repayment", "savings", "investment", "refund"] as const;
export type TxType = (typeof TX_TYPES)[number];
export type LoanKind = "receivable" | "payable";

export const ACCOUNT_TYPES = ["cash", "bank", "bkash", "nagad", "rocket", "credit_card", "savings", "investment", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface ParsedTransaction {
  type: TxType;
  amount: Poisha;
  description: string;
  category: string;
  accountHint?: AccountType;
  toAccountHint?: AccountType;
  counterparty?: string;
  loanKind?: LoanKind;
  daysAgo: number;
  raw: string;
}

export type ParseResult = { ok: true; tx: ParsedTransaction } | { ok: false; raw: string; error: string };

export interface ParseOptions {
  keywords?: KeywordOverrides;
}

const CURRENCY = new Set(["৳", "tk", "taka", "bdt", "টাকা", "takar", "/-"]);
const UNITS = new Set(["kg", "kgs", "g", "gm", "gram", "grams", "pcs", "pc", "piece", "pieces", "ta", "ti", "pis", "liter", "litre", "l", "ltr", "dozen", "hali", "packet", "packets", "x", "people", "person", "jon", "day", "days", "month", "months", "cup", "cups", "plate", "plates", "kezi", "kg."]);
const ACCOUNT_WORDS: Record<string, AccountType> = {
  cash: "cash",
  bank: "bank",
  bkash: "bkash", bikash: "bkash", "b-kash": "bkash", "বিকাশ": "bkash",
  nagad: "nagad", "নগদ": "nagad",
  rocket: "rocket",
  card: "credit_card", "credit": "credit_card",
};
const PREPOSITIONS = new Set(["via", "from", "to", "using", "by", "with", "diye", "in", "into", "theke", "e"]);
const FILLER = new Set(["spent", "spend", "paid", "pay", "for", "on", "bought", "buy", "kinlam", "khoroch", "khorch", "cost", "costs", "gave", "give", "received", "receive", "got", "get", "a", "an", "the", "of", "today", "aaj", "ajke", "yesterday", "gotokal", "গতকাল", "আজ", "my", "me", "i", "account", "dilam", "pelam", "nilam", "k"]);
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

const has = (text: string, ...kws: string[]) => kws.some((k) => hasKeyword(text, k));

function normalize(raw: string): string {
  let s = raw.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  s = s.replace(/(\d),(?=\d{3}(\D|$))/g, "$1"); // 40,000 -> 40000
  s = s.replace(/\/-/g, " /- ").replace(/৳/g, " ৳ ").replace(/[:=]/g, " ");
  s = s.replace(/(\d)([^\d\s.,])/gu, "$1 $2").replace(/(\p{L})(\d{2,})/gu, "$1 $2");
  return s;
}

interface Token {
  text: string;
  lower: string;
}

function tokenize(s: string): Token[] {
  return s
    .split(/\s+/)
    .map((t) => (/^\d+(\.\d+)?$/.test(t) ? t : t.replace(/^[(\[]+|[)\].!?,;]+$/g, "")))
    .filter(Boolean)
    .map((t) => ({ text: t, lower: t.toLowerCase() }));
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function parseLine(raw: string, opts: ParseOptions = {}): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, raw, error });
  const tokens = tokenize(normalize(raw.trim()));
  if (!tokens.length) return fail("Empty message.");

  // 1. Amount: prefer the single number tied to a currency marker; skip quantities like "2 kg".
  type Cand = { idx: number; value: number; consumed: number[]; marked: boolean };
  const cands: Cand[] = [];
  tokens.forEach((t, i) => {
    if (!/^\d+(\.\d+)?$/.test(t.text)) return;
    const consumed = [i];
    let value = Number(t.text);
    let j = i + 1;
    if (tokens[j]?.lower === "k") {
      value *= 1000;
      consumed.push(j++);
    }
    if (tokens[j] && UNITS.has(tokens[j].lower)) return; // quantity, not money
    let marked = false;
    if (tokens[j] && CURRENCY.has(tokens[j].lower)) {
      marked = true;
      consumed.push(j);
    }
    if (i > 0 && CURRENCY.has(tokens[i - 1].lower)) {
      marked = true;
      consumed.push(i - 1);
    }
    cands.push({ idx: i, value, consumed, marked });
  });
  const marked = cands.filter((c) => c.marked);
  let chosen: Cand | undefined;
  if (marked.length === 1) chosen = marked[0];
  else if (marked.length === 0 && cands.length === 1) chosen = cands[0];
  if (!chosen) {
    return fail(cands.length === 0 ? "I couldn't find an amount." : "I found more than one number — which one is the amount? Add 'tk' after it.");
  }
  if (chosen.value <= 0) return fail("Amount must be greater than zero.");
  let amount: Poisha;
  try {
    amount = toPoisha(chosen.value);
  } catch {
    return fail("That amount is not valid.");
  }

  const rest = tokens.filter((_, i) => !chosen!.consumed.includes(i) && !CURRENCY.has(tokens[i].lower));
  const lower = rest.map((t) => t.lower).join(" ");

  // 2. Accounts mentioned ("from bank to bkash", "via nagad", "card bill").
  let accountHint: AccountType | undefined;
  let toAccountHint: AccountType | undefined;
  const accountIdx = new Set<number>();
  rest.forEach((t, i) => {
    const acct = ACCOUNT_WORDS[t.lower];
    if (!acct) return;
    if (t.lower === "credit" && rest[i + 1]?.lower !== "card") return;
    if (t.lower === "card" && rest[i - 1]?.lower === "credit") {
      accountIdx.add(i);
      return;
    }
    accountIdx.add(i);
    const prev = rest[i - 1]?.lower;
    if (prev && PREPOSITIONS.has(prev)) accountIdx.add(i - 1);
    if (prev === "to" || prev === "into") toAccountHint = acct;
    else if (!accountHint) accountHint = acct;
    else if (!toAccountHint) toAccountHint = acct;
  });
  if (has(lower, "savings account", "savings acc")) toAccountHint = "savings";

  // 3. Transaction type, most specific signal first.
  let type: TxType;
  let loanKind: LoanKind | undefined;
  let category: string | null = null;
  const isCardBill = has(lower, "card bill", "card payment", "credit card bill");
  if (isCardBill) {
    type = "transfer";
    accountHint = [accountHint, toAccountHint].find((h) => h && h !== "credit_card");
    toAccountHint = "credit_card";
  } else if (has(lower, "transfer", "transferred", "moved", "send money", "cash out", "cashout") && (toAccountHint || (accountHint && rest.some((t) => t.lower === "to")))) {
    type = "transfer";
  } else if (has(lower, "refund", "refunded", "cashback", "ferot", "ফেরত") && !has(lower, "loan", "dhar", "ধার")) {
    type = "refund";
  } else if (has(lower, "interest", "sud", "সুদ")) {
    type = has(lower, "received", "got", "earned", "pelam", "income") ? "income" : "expense";
    category = type === "income" ? "interest_income" : "interest";
  } else if (has(lower, "repaid", "repay", "repayment", "paid back", "pay back", "returned", "return", "got back", "back")
      && has(lower, "loan", "dhar", "ধার", "repaid", "repay", "repayment", "paid back", "pay back", "got back", "returned")) {
    type = "loan_repayment";
    const startsWithName = /^[A-Z]/.test(rest[0]?.text ?? "") && !FILLER.has(rest[0].lower) && !has(rest[0].lower, "repaid", "loan");
    loanKind = startsWithName || has(lower, "received", "got back", "got", "pelam", "returned me", "paid me", "me back") ? "receivable" : "payable";
  } else if (has(lower, "lent", "lend", "dhar dilam", "loan to", "gave loan", "given loan") || (has(lower, "loan", "dhar", "ধার") && has(lower, "gave", "give", "dilam", "given", "to"))) {
    type = "loan_given";
  } else if (has(lower, "borrowed", "borrow", "dhar nilam", "loan from", "took loan", "took a loan") || (has(lower, "loan", "dhar", "ধার") && has(lower, "received", "got", "took", "nilam", "pelam", "from"))) {
    type = "loan_received";
  } else if (has(lower, "loan", "dhar", "ধার")) {
    return fail("Is this a loan you gave, a loan you received, or a repayment? e.g. 'gave Amit 2000 loan' or 'borrowed 2000 from Amit'.");
  } else if (has(lower, "saved", "save", "savings", "saving", "dps", "sonchoy", "সঞ্চয়")) {
    type = "savings";
    toAccountHint ??= "savings";
  } else if (has(lower, "invested", "invest", "investment", "shares", "share", "stock", "stocks", "sanchaypatra", "sonchoypotro", "fdr", "mutual fund")) {
    type = "investment";
  } else if (has(lower, "salary", "beton", "বেতন", "bonus", "income", "earned", "got paid", "upwork", "fiverr", "freelance", "received", "pelam", "পেলাম")) {
    type = "income";
  } else {
    type = "expense";
  }

  // 4. Counterparty for loans: "gave Amit", "from Amit", "Amit paid back".
  let counterparty: string | undefined;
  if (type.startsWith("loan")) {
    const stop = new Set([...FILLER, ...PREPOSITIONS, "loan", "dhar", "back", "him", "her", "them", "lent", "lend", "borrowed", "repaid", "returned", "took", ...Object.keys(ACCOUNT_WORDS)]);
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (stop.has(t.lower) || !/^\p{L}/u.test(t.text)) continue;
      const prev = rest[i - 1]?.lower;
      const isNameLike = /^\p{Lu}/u.test(t.text) || ["gave", "to", "from", "lent", "lend", "repaid", "by"].includes(prev ?? "");
      if (isNameLike) {
        counterparty = capitalize(t.text);
        break;
      }
    }
  }

  // 5. Days ago.
  const daysAgo = has(raw.toLowerCase(), "yesterday", "gotokal", "গতকাল") ? 1 : 0;

  // 6. Category.
  const overrides = opts.keywords ?? {};
  if (!category) {
    if (type === "expense" || type === "refund") category = detectCategory(lower, "expense", overrides) ?? "other";
    else if (type === "income") category = detectCategory(lower, "income", overrides) ?? "other_income";
    else if (type === "transfer") category = "transfer";
    else if (type === "savings") category = "savings";
    else if (type === "investment") category = "investment";
    else category = "loan";
  }

  // 7. Description from what is left after removing amount, account and filler words.
  const descWords = rest
    .filter((t, i) => !accountIdx.has(i) && !FILLER.has(t.lower) && !(t.text === counterparty && type.startsWith("loan")))
    .map((t) => t.text);
  let description = descWords.join(" ").trim();
  if (type === "loan_given") description = counterparty ? `Loan to ${counterparty}` : "Loan given";
  else if (type === "loan_received") description = counterparty ? `Loan from ${counterparty}` : "Loan received";
  else if (type === "loan_repayment") description = loanKind === "receivable" ? `Repayment from ${counterparty ?? "borrower"}` : `Repayment to ${counterparty ?? "lender"}`;
  else if (type === "transfer" && isCardBill) description = "Credit card bill";
  else if (type === "refund" && !detectCategory(lower, "expense", overrides)) description = "Refund";

  if (!description) {
    if (type === "expense") return fail(`What was ${chosen.value} tk spent on? e.g. 'lunch ${chosen.value}'.`);
    description = categoryLabel(category);
  }
  description = capitalize(description).slice(0, 200);

  return { ok: true, tx: { type, amount, description, category, accountHint, toAccountHint, counterparty, loanKind, daysAgo, raw } };
}

/** Splits a message into one transaction per line (or `;` / `,`); segments without an amount join the next one. */
export function parseMessage(text: string, opts: ParseOptions = {}): ParseResult[] {
  const normalized = text.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/(\d),(?=\d{3}(\D|$))/g, "$1");
  const segments = normalized.split(/\n|;|,(?!\d)/).map((s) => s.trim()).filter(Boolean);
  const merged: string[] = [];
  let carry = "";
  for (const seg of segments) {
    const s = carry ? `${carry} ${seg}` : seg;
    if (/\d/.test(seg)) {
      merged.push(s);
      carry = "";
    } else carry = s;
  }
  if (carry) merged.push(carry);
  return merged.slice(0, 50).map((line) => parseLine(line, opts));
}
