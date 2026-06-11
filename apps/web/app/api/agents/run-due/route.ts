import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cronMatches } from "@/lib/cron";
import { runAgent } from "@/lib/agentRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called by the Railway worker once a minute (Bearer CRON_SECRET).
 * Finds enabled agents whose cron matches the current minute and runs
 * them. last_run_at guards against double-firing if two ticks overlap.
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization");
  const open = !process.env.APP_PASSWORD && !process.env.CRON_SECRET; // local dev
  if (!open && bearer !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: agents, error } = await db
    .from("agents")
    .select("id, name, schedule_cron, last_run_at")
    .eq("enabled", true)
    .not("schedule_cron", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const due = (agents || []).filter((a) => {
    if (!a.schedule_cron || !cronMatches(a.schedule_cron, now)) return false;
    // skip if it already ran in the last 55s (double-tick guard)
    if (a.last_run_at && now.getTime() - new Date(a.last_run_at).getTime() < 55_000) return false;
    return true;
  });

  const results: { id: string; name: string; status: string }[] = [];
  for (const a of due) {
    try {
      const outcome = await runAgent(a.id, "schedule");
      results.push({ id: a.id, name: a.name, status: outcome.status });
    } catch (e: any) {
      results.push({ id: a.id, name: a.name, status: `error: ${e.message}` });
    }
  }

  return NextResponse.json({ ok: true, due: due.length, results });
}
