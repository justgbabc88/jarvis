import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agentRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // agent loops can take a few minutes

/** "Run now" from the Agents screen. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const outcome = await runAgent(id, "manual");
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
