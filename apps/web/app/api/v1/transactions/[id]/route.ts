import { correctTransaction, getTransaction, objectId, transactionPatch } from "@finance/core";
import { ok, route } from "@/lib/api";

export const GET = route(async (_req, p) => ok(await getTransaction(objectId.parse(p.id))));
export const PATCH = route(async (req, p) => ok(await correctTransaction(objectId.parse(p.id), transactionPatch.parse(await req.json()), "web")));
