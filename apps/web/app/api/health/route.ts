import { mongoose } from "@finance/core";
import { db } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db();
    return Response.json({ ok: mongoose.connection.readyState === 1 });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
