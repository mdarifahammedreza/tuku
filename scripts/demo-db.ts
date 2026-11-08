// Starts a throwaway in-memory MongoDB with ~3 months of realistic demo data (for UI previews; never touches real data).
// Usage: pnpm tsx scripts/demo-db.ts   -> prints a MONGODB_URI to use with `pnpm dev:web`
import { MongoMemoryServer } from "mongodb-memory-server";
import { addDays, connectDB, createAccount, ensureSetup, parseMessage, recordTelegramMessage, setBudget, dhakaParts, createSavingsGoal, updateProfile } from "../packages/core/src";

const mongod = await MongoMemoryServer.create({ instance: { port: 27099 } });
const uri = mongod.getUri("finance_demo");
await connectDB(uri);
await ensureSetup();
const bank = await createAccount({ name: "City Bank", type: "bank", openingBalance: 25000 }, "system");
await createAccount({ name: "bKash", type: "bkash", openingBalance: 1500 }, "system");
await createAccount({ name: "Cash", type: "cash", openingBalance: 0 }, "system").catch(() => {});
await updateProfile({ monthlySalary: 45000, emergencyFundTarget: 150000 }, "system");

const daily = ["cha 15\nporatha 30", "rickshaw 40\nlunch 150", "alu 30\npiaj 60\ndim 145", "cng 120 bkash", "coffee 180", "singara 20\ncha 15", "bus 30\ndinner 220", "medicine 340", "fuchka 80", "chicken 420\nsobji 90"];
let msg = 1;
const now = new Date();
for (let d = 85; d >= 0; d--) {
  const at = addDays(now, -d);
  const { day } = dhakaParts(at);
  const lines = [daily[d % daily.length], daily[(d * 7) % daily.length]];
  if (day === 1) lines.push("salary 45000 bank", "rent 12000 bank", "internet bill 1000 bank", "saved 5000 bank");
  if (day === 5) lines.push("transfer 4000 from bank to bkash", "mobile recharge 300 bkash");
  if (day === 12) lines.push("shirt 1800 bkash");
  if (day === 18) lines.push("netflix 650 bank");
  if (d === 40) lines.push("gave Amit 2000 taka loan");
  if (d === 10) lines.push("Amit paid back 500");
  if (d === 20) lines.push("daraz refund 600 bkash");
  const txs = parseMessage(lines.join("\n")).map((r: any) => r.tx);
  await recordTelegramMessage(1, msg++, txs, at);
}
const { year, month } = dhakaParts(now);
for (const [category, amount] of [["total", 30000], ["food", 5000], ["groceries", 5000], ["transport", 3000], ["shopping", 2500]] as const)
  await setBudget({ year, month, category, allocatedAmount: amount }, "system");
await createSavingsGoal({ name: "New laptop", targetAmount: 90000, accountId: undefined }, "system");
console.log(`DEMO_URI=${uri}`);
void bank;
