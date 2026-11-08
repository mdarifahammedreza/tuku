import { buildWeekly, last7DaysPeriod } from "@finance/core";
import { ok, route } from "@/lib/api";

export const GET = route(async () => ok(await buildWeekly(last7DaysPeriod())));
