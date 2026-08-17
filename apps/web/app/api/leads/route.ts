import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listLeads, saveLeads, leadCounts } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") || undefined;
  try {
    const [leads, counts] = await Promise.all([listLeads({ status }), leadCounts()]);
    return NextResponse.json({ leads, counts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const SaveSchema = z.object({
  leads: z
    .array(
      z.object({
        business_name: z.string().min(1),
        trade: z.string().optional(),
        city: z.string().optional(),
        pain: z.string().optional(),
        channel: z.string().optional(),
        contact: z.string().optional(),
        opener: z.string().optional(),
      })
    )
    .min(1),
  source: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = SaveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await saveLeads(parsed.data.leads, { source: parsed.data.source || "manual" });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
