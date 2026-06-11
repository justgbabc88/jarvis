import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = supabaseAdmin();
  const { data: goals } = await db.from("goals").select("*").order("created_at", { ascending: false });
  const { data: suggestions } = await db
    .from("suggestions")
    .select("*")
    .order("created_at", { ascending: false });
  return NextResponse.json({ goals: goals || [], suggestions: suggestions || [] });
}

const CreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  target_date: z.string().optional(),
  business_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("goals")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      target_date: parsed.data.target_date || null,
      business_id: parsed.data.business_id || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}
