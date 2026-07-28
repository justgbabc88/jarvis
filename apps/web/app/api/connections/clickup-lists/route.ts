import { NextRequest, NextResponse } from "next/server";
import { fetchClickUpLists } from "@/lib/connectors/clickup";

export const dynamic = "force-dynamic";

/** Fetch the ClickUp list hierarchy for the list picker (token not stored). */
export async function POST(req: NextRequest) {
  const { api_token } = await req.json().catch(() => ({}));
  if (!api_token) return NextResponse.json({ error: "missing api_token" }, { status: 400 });
  try {
    const lists = await fetchClickUpLists({ api_token });
    return NextResponse.json({ lists });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
