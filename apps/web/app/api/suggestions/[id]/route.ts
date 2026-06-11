import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Approve or reject a suggestion. Approving queues the work: it creates an
 * 'other' approval record describing the job, which the agent runner picks
 * up. (Actual execution lands in the agents phase.) Any send/post/spend the
 * job later attempts still goes through its own approval.
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

  await db.from("suggestions").update({ status: decision }).eq("id", id);

  if (decision === "approved") {
    await db.from("activity_log").insert({
      type: "goal",
      summary: `Approved suggestion: “${suggestion.title}”. Queued for an agent to run.`,
      meta: { suggestion_id: id, job_spec: suggestion.job_spec },
    });
  }

  return NextResponse.json({ ok: true });
}
