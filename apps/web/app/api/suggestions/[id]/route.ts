import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runAdhocJob } from "@/lib/agentRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Approve or reject a goal suggestion.
 * Approving runs it immediately as a one-off agent job. Anything inside
 * that job which would send / post / delete / spend still goes through
 * its own approval — approving the suggestion only authorizes the work,
 * not the risky actions.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { decision } = await req.json().catch(() => ({}));
  if (!["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data: suggestion } = await db.from("suggestions").select("*").eq("id", id).single();
  if (!suggestion) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (decision === "rejected") {
    await db.from("suggestions").update({ status: "rejected" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  await db.from("suggestions").update({ status: "running" }).eq("id", id);

  try {
    const outcome = await runAdhocJob(
      suggestion.title,
      suggestion.job_spec || `${suggestion.title}\n\n${suggestion.rationale || ""}`
    );
    await db
      .from("suggestions")
      .update({ status: "done", agent_run_id: outcome.runId })
      .eq("id", id);
    return NextResponse.json({ ok: true, run: outcome });
  } catch (e: any) {
    await db.from("suggestions").update({ status: "approved" }).eq("id", id); // approved but not run
    return NextResponse.json({ error: `approved, but the run failed: ${e.message}` }, { status: 500 });
  }
}
