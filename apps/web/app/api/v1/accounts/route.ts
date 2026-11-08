import { accountInput, createAccount, getBalances, listAccounts } from "@finance/core";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  const [accounts, balances] = await Promise.all([listAccounts(true), getBalances()]);
  return ok(accounts.map((a) => ({ ...a, balance: balances.accounts.find((b) => b.id === a._id.toString())?.balance ?? null })));
});
export const POST = route(async (req) => ok(await createAccount(accountInput.parse(await req.json()), "web"), 201));
