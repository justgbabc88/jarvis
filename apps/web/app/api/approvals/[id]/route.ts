import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Approve or reject a pending action. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { decision } = await req.json().catch(() => ({}));
  if (!["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("approvals")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("activity_log").insert({
    type: "approval",
    summary: `You ${decision} “${data?.title}”.`,
    business_id: null,
    meta: { approval_id: id, kind: data?.kind },
  });

  // NOTE: when approved, the worker picks this up to actually execute the
  // action (send / post / spend). Wired in the agents phase.
  return NextResponse.json({ ok: true, approval: data });
}
