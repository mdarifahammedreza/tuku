import { ok, route } from "@/lib/api";
import { getInsights } from "@/lib/insights";

export const GET = route(async () => ok(await getInsights()));
