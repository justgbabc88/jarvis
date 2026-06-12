import { NextRequest, NextResponse } from "next/server";
import { ask, anthropicConfigured } from "@/lib/anthropic";
import {
  getBusinessCards,
  getYesterdayActivity,
  getActiveGoals,
  getDailyMetrics,
  DailyMetric,
} from "@/lib/data";
import { money } from "@/lib/format";

// Monday of the week a date falls in, as YYYY-MM-DD.
function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Compact per-business DAILY + WEEKLY history so Jarvis can answer trends. */
function historySection(daily: DailyMetric[], nameById: Map<string, string>): string {
  if (daily.length === 0) return "DAILY HISTORY: none yet";
  const byBiz = new Map<string, DailyMetric[]>();
  for (const d of daily) {
    if (!nameById.has(d.business_id)) continue;
    const arr = byBiz.get(d.business_id) || [];
    arr.push(d);
    byBiz.set(d.business_id, arr);
  }

  const parts: string[] = [];
  for (const [bizId, rows] of byBiz) {
    const name = nameById.get(bizId);
    const dayLines = rows
      .map((r) => `  ${r.metric_date}: rev ${money(r.revenue_cents)}, spend ${money(r.ad_spend_cents)}`)
      .join("\n");

    const weeks = new Map<string, { rev: number; spend: number }>();
    for (const r of rows) {
      const w = weekStart(r.metric_date);
      const e = weeks.get(w) || { rev: 0, spend: 0 };
      e.rev += r.revenue_cents;
      e.spend += r.ad_spend_cents;
      weeks.set(w, e);
    }
    const weekLines = [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([w, v]) =>
          `  week of ${w}: rev ${money(v.rev)}, spend ${money(v.spend)}, net ${money(v.rev - v.spend)}`
      )
      .join("\n");

    parts.push(`${name} — daily:\n${dayLines}\n${name} — weekly totals:\n${weekLines}`);
  }
  return `HISTORY (per day, oldest first; data starts when each source was connected):\n${parts.join("\n")}`;
}

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
  const [cards, activity, goals, daily] = await Promise.all([
    getBusinessCards(),
    getYesterdayActivity(),
    getActiveGoals(),
    getDailyMetrics(60),
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
    historySection(daily, new Map(cards.map((c) => [c.id, c.name]))),
    `WHAT JARVIS DID YESTERDAY:\n${
      activity.map((a) => `- ${a.summary}`).join("\n") || "nothing logged"
    }`,
    `ACTIVE GOALS:\n${goals.map((g: any) => `- ${g.title}`).join("\n") || "none set"}`,
  ].join("\n\n");

  const system = [
    "You are Jarvis, a concise personal business assistant being heard OUT LOUD.",
    "Answer in 2–5 short spoken sentences. No markdown, no bullet symbols, no headers — just natural speech.",
    "Exception: when asked for a day-by-day or week-by-week breakdown, walk through the periods briefly, one short line each, using the HISTORY data.",
    "Use the numbers provided; prefer the precomputed weekly totals over adding days yourself.",
    "If something isn't connected or has no data for a period, say so plainly and suggest connecting it.",
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
