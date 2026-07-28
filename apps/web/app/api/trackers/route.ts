import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listTrackersWithStats, createTracker } from "@/lib/trackers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const trackers = await listTrackersWithStats(true);
    return NextResponse.json({ trackers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  question: z.string().max(300).optional(),
  unit: z.string().max(30).optional(),
  business_id: z.string().uuid().nullish(),
});

export async function POST(req: NextRequest) {
  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const tracker = await createTracker(parsed.data);
    return NextResponse.json({ tracker });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
