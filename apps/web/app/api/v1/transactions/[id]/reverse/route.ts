import { z } from "zod";
import { objectId, reverseTransaction } from "@finance/core";
import { ok, route } from "@/lib/api";

const body = z.object({ reason: z.string().trim().min(1).max(200).default("Reversed from dashboard") });

export const POST = route(async (req, p) => {
  const { reason } = body.parse(await req.json().catch(() => ({})));
  return ok(await reverseTransaction(objectId.parse(p.id), reason, "web"));
});
