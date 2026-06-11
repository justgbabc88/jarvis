import { NextRequest, NextResponse } from "next/server";
import { anthropic, defaultModel, anthropicConfigured } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { getBusinessCards } from "@/lib/data";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Look at a goal + current business numbers and propose concrete moves:
 * revenue-generating activities Jarvis can do, and things to research.
 * Each suggestion carries a plain-English job_spec an agent can run once
 * the user approves it.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!anthropicConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data: goal } = await db.from("goals").select("*").eq("id", id).single();
  if (!goal) return NextResponse.json({ error: "goal not found" }, { status: 404 });

  const cards = await getBusinessCards();
  const businessContext = cards
    .map(
      (c) =>
        `${c.name}: revenue MTD ${money(c.monthRevenueCents)}, ad spend MTD ${money(c.monthSpendCents)}`
    )
    .join("; ");

  const system =
    "You are Jarvis, a sharp operator who helps a founder hit goals. " +
    "Given a goal and current business numbers, propose 4-6 specific, high-leverage actions. " +
    "Each is either a 'revenue' action (something that can directly make money) or a 'research' action. " +
    "Every action must be concrete enough that an AI agent could execute it. " +
    "Respond ONLY as JSON: " +
    '{"suggestions":[{"kind":"revenue|research","title":"...","rationale":"...","job_spec":"plain-English instructions an agent can follow"}]}';

  const prompt =
    `GOAL: ${goal.title}\n` +
    (goal.description ? `DETAILS: ${goal.description}\n` : "") +
    (goal.target_date ? `TARGET DATE: ${goal.target_date}\n` : "") +
    `\nCURRENT BUSINESS NUMBERS: ${businessContext || "none connected yet"}\n\n` +
    "Propose the suggestions now.";

  const res = await anthropic().messages.create({
    model: defaultModel(),
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b): b is any => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { suggestions?: any[] } = {};
  try {
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    parsed = JSON.parse(json);
  } catch {
    return NextResponse.json({ error: "could not parse suggestions", raw: text }, { status: 502 });
  }

  const rows = (parsed.suggestions || []).slice(0, 8).map((s) => ({
    goal_id: id,
    kind: s.kind === "research" ? "research" : "revenue",
    title: String(s.title || "").slice(0, 200),
    rationale: s.rationale ? String(s.rationale) : null,
    job_spec: s.job_spec ? String(s.job_spec) : null,
    status: "proposed",
  }));

  if (rows.length) await db.from("suggestions").insert(rows);
  return NextResponse.json({ ok: true, count: rows.length });
}
