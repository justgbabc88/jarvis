import { NextRequest, NextResponse } from "next/server";
import { ask, anthropicConfigured } from "@/lib/anthropic";
import { getBusinessCards, getYesterdayActivity, getActiveGoals } from "@/lib/data";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { question } = await req.json().catch(() => ({ question: "" }));
  const q = String(question || "").trim();
  if (!q) return NextResponse.json({ error: "no question" }, { status: 400 });

  if (!anthropicConfigured()) {
    return NextResponse.json({
      answer: "I'm not connected to Claude yet — add your ANTHROPIC_API_KEY and ask me again.",
    });
  }

  // Assemble a compact, current picture for Jarvis to speak from.
  const [cards, activity, goals] = await Promise.all([
    getBusinessCards(),
    getYesterdayActivity(),
    getActiveGoals(),
  ]);

  const businessLines = cards
    .map(
      (c) =>
        `- ${c.name}: revenue MTD ${money(c.monthRevenueCents)}, ad spend MTD ${money(
          c.monthSpendCents
        )}, net ${money(c.monthRevenueCents - c.monthSpendCents)} (today: rev ${money(
          c.todayRevenueCents
        )}, spend ${money(c.todaySpendCents)})`
    )
    .join("\n");

  const context = [
    `BUSINESSES (month-to-date):\n${businessLines || "none configured"}`,
    `WHAT JARVIS DID YESTERDAY:\n${
      activity.map((a) => `- ${a.summary}`).join("\n") || "nothing logged"
    }`,
    `ACTIVE GOALS:\n${goals.map((g: any) => `- ${g.title}`).join("\n") || "none set"}`,
  ].join("\n\n");

  const system = [
    "You are Jarvis, a concise personal business assistant being heard OUT LOUD.",
    "Answer in 2–5 short spoken sentences. No markdown, no bullet symbols, no headers — just natural speech.",
    "Use the numbers provided. If something isn't connected or has no data, say so plainly and suggest connecting it.",
    "Round money to whole dollars when speaking. Be direct and useful, not chatty.",
  ].join(" ");

  try {
    const answer = await ask({
      system,
      prompt: `Here is the current snapshot:\n\n${context}\n\nThe user asked: "${q}"\n\nAnswer for spoken delivery.`,
      maxTokens: 400,
    });
    return NextResponse.json({ answer });
  } catch (e: any) {
    return NextResponse.json({ answer: `I hit an error reaching Claude: ${e.message}` });
  }
}
