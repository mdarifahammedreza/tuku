import { getProfile, profilePatch, updateProfile } from "@finance/core";
import { ok, route } from "@/lib/api";

export const GET = route(async () => ok(await getProfile()));
export const PATCH = route(async (req) => ok(await updateProfile(profilePatch.parse(await req.json()), "web")));
