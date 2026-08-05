import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/jarvis";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { question } = await req.json().catch(() => ({ question: "" }));
  const q = String(question || "").trim();
  if (!q) return NextResponse.json({ error: "no question" }, { status: 400 });
  const answer = await answerQuestion(q, "voice");
  return NextResponse.json({ answer });
}
