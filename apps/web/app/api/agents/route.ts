import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidCron } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Agents + their recent runs, for the Agents screen. */
export async function GET() {
  const db = supabaseAdmin();
  const [{ data: agents, error }, { data: runs }] = await Promise.all([
    db.from("agents").select("*").order("created_at", { ascending: false }),
    db
      .from("agent_runs")
      .select("id, agent_id, trigger, status, summary, label, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(60),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agents: agents || [], runs: runs || [] });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1), // the job, in plain English
  schedule_cron: z.string().optional().nullable(),
  business_id: z.string().uuid().optional().nullable(),
  enabled: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, description, schedule_cron, business_id, enabled } = parsed.data;

  if (schedule_cron && !isValidCron(schedule_cron)) {
    return NextResponse.json(
      { error: "Invalid schedule. Use 5-field cron, e.g. '0 9 * * *' for daily at 9am." },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agents")
    .insert({
      name,
      description,
      // The runner wraps this in its safety harness at run time; storing the
      // plain-English job keeps it editable by the owner.
      system_prompt: description,
      schedule_cron: schedule_cron || null,
      business_id: business_id || null,
      enabled: enabled ?? false,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data });
}
