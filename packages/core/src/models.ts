import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { ACCOUNT_TYPES, TX_TYPES } from "./parser";

const money = { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: "Amount must be integer poisha" } };
const opts = { timestamps: true, versionKey: false } as const;

function model<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T>) ?? mongoose.model<T>(name, schema);
}

const accountSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    openingBalance: { ...money, default: 0 },
    currency: { type: String, default: "BDT" },
    isActive: { type: Boolean, default: true },
  },
  opts,
);
accountSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

const transactionSchema = new Schema(
  {
    type: { type: String, enum: TX_TYPES, required: true },
    amount: { ...money, min: 1 },
    interestAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "BDT" },
    description: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    toAccountId: { type: Schema.Types.ObjectId, ref: "Account" },
    counterparty: { type: String, trim: true, maxlength: 80 },
    loanKind: { type: String, enum: ["receivable", "payable"] },
    transactionDate: { type: Date, required: true },
    paymentMethod: String,
    source: { type: String, enum: ["telegram", "web", "mcp", "system"], required: true },
    telegramChatId: Number,
    telegramMessageId: Number,
    lineIndex: Number,
    telegramReplyMessageId: Number,
    notes: { type: String, maxlength: 500 },
    status: { type: String, enum: ["confirmed", "reversed"], default: "confirmed" },
    reversedAt: Date,
    reversalReason: String,
    revision: { type: Number, default: 1 },
  },
  opts,
);
transactionSchema.index({ status: 1, transactionDate: -1 });
transactionSchema.index({ category: 1, transactionDate: -1 });
transactionSchema.index({ accountId: 1, transactionDate: -1 });
transactionSchema.index({ description: "text" });
// Idempotency: one transaction per Telegram message line, ever.
transactionSchema.index(
  { telegramChatId: 1, telegramMessageId: 1, lineIndex: 1 },
  { unique: true, partialFilterExpression: { telegramMessageId: { $type: "number" } } },
);

const budgetSchema = new Schema(
  {
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    category: { type: String, required: true }, // "total" = overall monthly budget
    allocatedAmount: { ...money, min: 0 },
  },
  opts,
);
budgetSchema.index({ year: 1, month: 1, category: 1 }, { unique: true });

const goalSchema = new Schema({
  name: { type: String, required: true },
  targetAmount: { ...money, min: 1 },
  accountId: { type: Schema.Types.ObjectId, ref: "Account" },
  deadline: Date,
  createdAt: { type: Date, default: Date.now },
});

const profileSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true },
    monthlySalary: { type: Number, default: 0 },
    incomeSources: [{ name: String, amount: Number }],
    defaultAccountId: { type: Schema.Types.ObjectId, ref: "Account" },
    goals: [goalSchema],
    emergencyFundTarget: { type: Number, default: 0 },
    reporting: {
      chatId: Number,
      daily: { type: Boolean, default: true },
      weekly: { type: Boolean, default: true },
      monthly: { type: Boolean, default: true },
    },
    categoryKeywords: { type: Schema.Types.Mixed, default: {} },
    currency: { type: String, default: "BDT" },
    timezone: { type: String, default: "Asia/Dhaka" },
  },
  opts,
);

// One document per report period; it doubles as the job-run record for the scheduler.
const reportSchema = new Schema(
  {
    reportType: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
    periodKey: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    totalIncome: Number,
    totalExpenses: Number,
    totalSavings: Number,
    remainingBalance: Number,
    categoryBreakdown: [{ category: String, amount: Number, share: Number, _id: false }],
    data: Schema.Types.Mixed,
    dataHash: String,
    aiAnalysis: String,
    aiSource: String, // "api" (automatic) or "claude-desktop" (saved via MCP)
    aiError: String,
    generatedAt: Date,
    deliveryStatus: { type: String, enum: ["pending", "delivering", "delivered", "failed", "skipped"], default: "pending" },
    deliveredParts: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    lockedUntil: Date,
    lastError: String,
    deliveredAt: Date,
  },
  opts,
);
reportSchema.index({ reportType: 1, periodKey: 1 }, { unique: true });

const auditSchema = new Schema(
  {
    action: { type: String, required: true }, // transaction.create | transaction.correct | transaction.reverse | budget.set | account.update ...
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    source: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
auditSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

// Two-step confirmation tokens for MCP mutation tools.
const confirmationSchema = new Schema({
  token: { type: String, required: true, unique: true },
  tool: { type: String, required: true },
  args: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const Account = model("Account", accountSchema);
export const Transaction = model("Transaction", transactionSchema);
export const Budget = model("Budget", budgetSchema);
export const Profile = model("Profile", profileSchema);
export const Report = model("Report", reportSchema);
export const AuditLog = model("AuditLog", auditSchema);
export const Confirmation = model("Confirmation", confirmationSchema);

export type AccountDoc = InferSchemaType<typeof accountSchema> & { _id: mongoose.Types.ObjectId };
export type TransactionDoc = InferSchemaType<typeof transactionSchema> & { _id: mongoose.Types.ObjectId };
