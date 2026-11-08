import { accountPatch, objectId, updateAccount } from "@finance/core";
import { ok, route } from "@/lib/api";

export const PATCH = route(async (req, p) => ok(await updateAccount(objectId.parse(p.id), accountPatch.parse(await req.json()), "web")));
