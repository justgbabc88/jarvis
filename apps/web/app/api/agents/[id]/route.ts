import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidCron } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, any> = {};
  for (const k of ["name", "description", "schedule_cron", "enabled", "business_id"]) {
    if (k in body) patch[k] = body[k];
  }
  if ("description" in patch) patch.system_prompt = patch.description;
  if (patch.schedule_cron && !isValidCron(patch.schedule_cron)) {
    return NextResponse.json({ error: "Invalid cron expression." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.from("agents").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  const { error } = await db.from("agents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
