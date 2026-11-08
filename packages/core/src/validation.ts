import { z } from "zod";
import { ACCOUNT_TYPES, TX_TYPES } from "./parser";

// Amounts at the API/MCP boundary are in taka (what humans type); they are converted to poisha inside.
export const takaAmount = z.number().positive().max(1_000_000_000).multipleOf(0.01);
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const isoDate = z.coerce.date();

export const transactionInput = z
  .object({
    type: z.enum(TX_TYPES),
    amount: takaAmount,
    interestAmount: z.number().min(0).max(1_000_000_000).optional(),
    description: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(40).optional(),
    accountId: objectId.optional(),
    toAccountId: objectId.optional(),
    counterparty: z.string().trim().max(80).optional(),
    loanKind: z.enum(["receivable", "payable"]).optional(),
    transactionDate: isoDate.optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((v) => v.type !== "transfer" || v.toAccountId, { message: "Transfers need toAccountId", path: ["toAccountId"] })
  .refine((v) => v.type !== "loan_repayment" || v.loanKind, { message: "Repayments need loanKind", path: ["loanKind"] })
  .refine((v) => !v.interestAmount || v.interestAmount <= v.amount, { message: "Interest cannot exceed amount", path: ["interestAmount"] });

export const transactionPatch = z
  .object({
    type: z.enum(TX_TYPES),
    amount: takaAmount,
    interestAmount: z.number().min(0).max(1_000_000_000),
    description: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(40),
    accountId: objectId,
    toAccountId: objectId.nullable(),
    counterparty: z.string().trim().max(80),
    loanKind: z.enum(["receivable", "payable"]),
    transactionDate: isoDate,
    notes: z.string().max(500),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const transactionFilters = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(TX_TYPES).optional(),
  category: z.string().max(40).optional(),
  accountId: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(["confirmed", "reversed", "all"]).default("confirmed"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const accountInput = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(ACCOUNT_TYPES),
  openingBalance: z.number().min(-1_000_000_000).max(1_000_000_000).multipleOf(0.01).default(0),
});
export const accountPatch = z
  .object({ name: z.string().trim().min(1).max(60), openingBalance: z.number().min(-1_000_000_000).max(1_000_000_000).multipleOf(0.01), isActive: z.boolean() })
  .partial();

export const budgetInput = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  category: z.string().trim().min(1).max(40),
  allocatedAmount: z.number().min(0).max(1_000_000_000).multipleOf(0.01),
});

export const goalInput = z.object({
  name: z.string().trim().min(1).max(80),
  targetAmount: takaAmount,
  accountId: objectId.optional(),
  deadline: isoDate.optional(),
});

export const profilePatch = z
  .object({
    monthlySalary: z.number().min(0).max(1_000_000_000),
    emergencyFundTarget: z.number().min(0).max(1_000_000_000),
    defaultAccountId: objectId,
    incomeSources: z.array(z.object({ name: z.string().max(60), amount: z.number().min(0) })).max(20),
    reporting: z.object({ daily: z.boolean(), weekly: z.boolean(), monthly: z.boolean() }).partial(),
    categoryKeywords: z.record(z.string().max(40), z.array(z.string().max(40)).max(100)),
  })
  .partial();
