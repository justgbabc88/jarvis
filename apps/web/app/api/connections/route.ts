import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { encryptJson } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** List connections WITHOUT exposing decrypted credentials. */
export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("connections")
    .select("id, provider, label, config, status, last_checked, last_error, created_at")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connections: data });
}

const CreateSchema = z.object({
  provider: z.enum(["nmi", "meta", "email", "calendar_ics", "google_calendar", "clickup", "mcp"]),
  label: z.string().min(1),
  credentials: z.record(z.any()).default({}),
  config: z.record(z.any()).default({}),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("connections")
    .insert({
      provider: parsed.data.provider,
      label: parsed.data.label,
      credentials: encryptJson(parsed.data.credentials), // stored as encrypted string
      config: parsed.data.config,
      status: "connected",
    })
    .select("id, provider, label, config, status, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data });
}
