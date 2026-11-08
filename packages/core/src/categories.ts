// Deterministic keyword dictionaries. Users can extend these via profile.categoryKeywords.
export interface CategoryDef {
  id: string;
  label: string;
  kind: "expense" | "income" | "other";
  keywords: string[];
}

export const CATEGORIES: CategoryDef[] = [
  { id: "groceries", label: "Groceries", kind: "expense", keywords: ["alu", "aloo", "potato", "piaj", "peyaj", "onion", "chal", "rice", "dal", "tel", "oil", "mach", "fish", "mangsho", "meat", "chicken", "murgi", "beef", "dim", "egg", "sobji", "vegetable", "vegetables", "morich", "ada", "rosun", "lobon", "salt", "chini", "sugar", "dudh", "milk", "bazar", "grocery", "groceries", "atta", "fruit", "fruits", "kola", "banana", "আলু", "পেঁয়াজ", "চাল", "ডাল", "তেল", "মাছ", "মাংস", "ডিম", "সবজি", "দুধ", "বাজার"] },
  { id: "food", label: "Food & Dining", kind: "expense", keywords: ["poratha", "paratha", "porota", "cha", "tea", "coffee", "lunch", "dinner", "breakfast", "nasta", "nashta", "snack", "snacks", "singara", "samosa", "puri", "biriyani", "biryani", "khichuri", "fuchka", "chotpoti", "burger", "pizza", "restaurant", "food", "khabar", "juice", "water", "pani", "biscuit", "cake", "ice cream", "foodpanda", "চা", "পরোটা", "নাস্তা", "খাবার", "দুপুরের খাবার"] },
  { id: "transport", label: "Transport", kind: "expense", keywords: ["rickshaw", "riksha", "rikshaw", "cng", "bus", "uber", "pathao", "obhai", "train", "metro", "fuel", "petrol", "octane", "diesel", "auto", "taxi", "launch", "bike", "parking", "toll", "fare", "vara", "রিকশা", "বাস", "ভাড়া গাড়ি"] },
  { id: "housing", label: "Rent & Housing", kind: "expense", keywords: ["rent", "house rent", "bhara", "basha bhara", "flat", "maintenance", "service charge", "বাসা ভাড়া", "ভাড়া"] },
  { id: "utilities", label: "Bills & Utilities", kind: "expense", keywords: ["electricity", "electric", "current bill", "gas", "gas bill", "water bill", "wifi", "internet", "broadband", "mobile", "recharge", "flexiload", "flexi", "data pack", "bill", "বিল", "রিচার্জ"] },
  { id: "health", label: "Health", kind: "expense", keywords: ["medicine", "oushudh", "osudh", "doctor", "hospital", "clinic", "pharmacy", "test", "dental", "ওষুধ", "ডাক্তার"] },
  { id: "education", label: "Education", kind: "expense", keywords: ["book", "books", "course", "tuition", "school", "college", "university", "exam fee", "stationery", "pen", "khata", "বই"] },
  { id: "shopping", label: "Shopping", kind: "expense", keywords: ["clothes", "shirt", "pant", "shoes", "sandal", "panjabi", "saree", "dress", "bag", "watch", "daraz", "shopping", "gadget", "phone", "cosmetics", "জামা", "জুতা"] },
  { id: "personal", label: "Personal Care", kind: "expense", keywords: ["haircut", "salon", "parlour", "soap", "shampoo", "toothpaste", "laundry", "dhobi"] },
  { id: "entertainment", label: "Entertainment", kind: "expense", keywords: ["movie", "cinema", "game", "games", "outing", "trip", "tour", "travel", "hotel", "concert"] },
  { id: "subscriptions", label: "Subscriptions", kind: "expense", keywords: ["netflix", "spotify", "youtube premium", "chatgpt", "claude", "subscription", "icloud", "google one", "hoichoi", "chorki"] },
  { id: "family", label: "Family & Gifts", kind: "expense", keywords: ["family", "gift", "baba", "ma", "ammu", "abbu", "parents", "wedding", "birthday", "eid", "salami"] },
  { id: "charity", label: "Charity", kind: "expense", keywords: ["zakat", "donation", "sadaqah", "sadka", "mosque", "masjid", "charity", "দান"] },
  { id: "fees", label: "Fees & Charges", kind: "expense", keywords: ["fee", "charge", "cash out", "cashout", "service fee", "bank charge", "vat", "tax"] },
  { id: "interest", label: "Interest", kind: "expense", keywords: ["interest", "sud", "সুদ"] },
  { id: "salary", label: "Salary", kind: "income", keywords: ["salary", "beton", "bet0n", "বেতন", "payroll"] },
  { id: "freelance", label: "Freelance", kind: "income", keywords: ["freelance", "upwork", "fiverr", "client", "project payment", "gig"] },
  { id: "business", label: "Business", kind: "income", keywords: ["business", "sales", "profit", "commission"] },
  { id: "bonus", label: "Bonus", kind: "income", keywords: ["bonus", "incentive", "festival bonus"] },
  { id: "interest_income", label: "Interest Income", kind: "income", keywords: ["interest received", "interest income", "profit from fdr"] },
  { id: "other_income", label: "Other Income", kind: "income", keywords: [] },
  { id: "other", label: "Other", kind: "expense", keywords: [] },
  { id: "transfer", label: "Transfer", kind: "other", keywords: [] },
  { id: "savings", label: "Savings", kind: "other", keywords: [] },
  { id: "investment", label: "Investment", kind: "other", keywords: [] },
  { id: "loan", label: "Loan", kind: "other", keywords: [] },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryLabel(id: string): string {
  return CATEGORY_BY_ID.get(id)?.label ?? id;
}

export type KeywordOverrides = Record<string, string[]>;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary match that also works for Bangla script (no \b support there).
export function hasKeyword(text: string, kw: string): boolean {
  const re = new RegExp(`(^|[^\\p{L}\\p{M}])${escapeRe(kw.toLowerCase())}($|[^\\p{L}\\p{M}])`, "u");
  return re.test(text);
}

/** Best category for `text` among categories of `kind`. Longer keyword matches win ("house rent" over "rent"). */
export function detectCategory(text: string, kind: "expense" | "income", overrides: KeywordOverrides = {}): string | null {
  const lower = text.toLowerCase();
  let best: { id: string; len: number } | null = null;
  const defs = CATEGORIES.filter((c) => c.kind === kind).map((c) => ({ id: c.id, keywords: c.keywords }));
  // Custom categories defined only in overrides are treated as expense categories.
  if (kind === "expense") for (const id of Object.keys(overrides)) if (!CATEGORY_BY_ID.has(id)) defs.push({ id, keywords: [] });
  for (const c of defs) {
    for (const kw of [...(overrides[c.id] ?? []), ...c.keywords]) {
      if (kw.length > (best?.len ?? 0) && hasKeyword(lower, kw)) best = { id: c.id, len: kw.length };
    }
  }
  return best?.id ?? null;
}
