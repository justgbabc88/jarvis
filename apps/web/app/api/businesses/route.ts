import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("businesses")
    .select("*")
    .order("sort_order")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ businesses: data });
}

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  settings: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("businesses")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      settings: parsed.data.settings ?? {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ business: data });
}
