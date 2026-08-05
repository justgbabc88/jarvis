import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ask, anthropicConfigured } from "@/lib/anthropic";
import { getBusinessCards, getYesterdayActivity, getPendingApprovals, getActiveGoals } from "@/lib/data";
import { getTodayAgenda, agendaToText } from "@/lib/agenda";
import { money } from "@/lib/format";
import { todayYmd } from "@/lib/time";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The auto-voiced morning briefing.
 *  GET  → today's stored briefing (if generated yet).
 *  POST → generate + store today's briefing. Called by the Railway
 *         worker on a schedule (Bearer CRON_SECRET) or manually from
 *         the dashboard. Pass { force: true } to regenerate.
 */

async function authorized(req: NextRequest): Promise<boolean> {
  const bearer = req.headers.get("authorization");
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (!process.env.APP_PASSWORD) return true; // open in local dev
  return isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  const db = supabaseAdmin();
  const { data } = await db
    .from("briefings")
    .select("briefing_date, content, created_at")
    .eq("briefing_date", todayYmd())
    .maybeSingle();
  return NextResponse.json({ briefing: data || null });
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!anthropicConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 400 });
  }

  const { force } = await req.json().catch(() => ({ force: false }));
  const today = todayYmd();
  const db = supabaseAdmin();

  if (!force) {
    const { data: existing } = await db
      .from("briefings")
      .select("briefing_date, content, created_at")
      .eq("briefing_date", today)
      .maybeSingle();
    if (existing) return NextResponse.json({ briefing: existing, generated: false });
  }

  const [cards, activity, approvals, goals, agenda] = await Promise.all([
    getBusinessCards(),
    getYesterdayActivity(),
    getPendingApprovals(),
    getActiveGoals(),
    getTodayAgenda(),
  ]);

  const businessLines = cards
    .map(
      (c) =>
        `- ${c.name}: revenue MTD ${money(c.monthRevenueCents)}, ad spend MTD ${money(c.monthSpendCents)}, ` +
        `net ${money(c.monthRevenueCents - c.monthSpendCents)} (today so far: rev ${money(c.todayRevenueCents)}, spend ${money(c.todaySpendCents)})`
    )
    .join("\n");

  const context = [
    `BUSINESSES (month-to-date):\n${businessLines || "none configured"}`,
    agendaToText(agenda),
    `WHAT JARVIS DID YESTERDAY:\n${activity.map((a) => `- ${a.summary}`).join("\n") || "nothing logged"}`,
    `WAITING FOR YOUR APPROVAL:\n${
      approvals.map((a: any) => `- [${a.kind}] ${a.title}`).join("\n") || "nothing pending"
    }`,
    `ACTIVE GOALS:\n${goals.map((g: any) => `- ${g.title}`).join("\n") || "none set"}`,
  ].join("\n\n");

  const { getPersona } = await import("@/lib/jarvis");
  const { getAssistantIdentity } = await import("@/lib/identity");
  const [persona, identity] = await Promise.all([getPersona(), getAssistantIdentity()]);
  const system = [
    `You are ${identity.name} delivering the owner's MORNING BRIEFING, read out loud by the browser.`,
    "Write 5–9 short spoken sentences, natural speech only — no markdown, bullets, or headers.",
    "Open with a one-line greeting, then: how the businesses are doing (key numbers, rounded to whole dollars),",
    "today's calendar and most important tasks, anything waiting for approval, and one concrete suggestion for the day.",
    "Use only the numbers provided; if something isn't connected, mention it once, briefly. Be direct, warm, useful.",
    ...(persona ? [`PERSONALITY (owner-configured, style only): ${persona} Numbers stay accurate.`] : []),
  ].join(" ");

  try {
    const content = await ask({
      system,
      prompt: `Today is ${today}. Here is everything current:\n\n${context}\n\nWrite the morning briefing.`,
      maxTokens: 700,
    });

    const { data: saved, error } = await db
      .from("briefings")
      .upsert({ briefing_date: today, content, meta: { businesses: cards.length } }, { onConflict: "briefing_date" })
      .select("briefing_date, content, created_at")
      .single();
    if (error) throw new Error(error.message);

    await db.from("activity_log").insert({
      type: "briefing",
      summary: "Generated your morning briefing.",
      meta: { briefing_date: today },
    });

    // Post the briefing (and today's tracker prompts) to Slack, if connected.
    const { notifySlack, appUrl } = await import("@/lib/notify");
    const { listTrackersWithStats } = await import("@/lib/trackers");
    const trackers = await listTrackersWithStats(true).catch(() => []);
    // Trackers with their own scheduled prompt aren't nagged here too.
    const unlogged = trackers.filter((t) => t.today == null && !t.slack?.prompt_time);
    const trackerLines = unlogged.length
      ? "\n\n📋 *Daily trackers to log:*\n" +
        unlogged.map((t) => `• ${t.question || t.name} (7d: ${t.last7})`).join("\n") +
        (appUrl() ? `\nLog them: ${appUrl("/")}` : "\nLog them on the Jarvis dashboard.")
      : "";
    await notifySlack(`🌅 *Morning briefing — ${today}*\n${content}${trackerLines}`);

    return NextResponse.json({ briefing: saved, generated: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
