import { getOverview } from "@finance/core";
import { ok, route } from "@/lib/api";

export const GET = route(async () => ok(await getOverview()));
