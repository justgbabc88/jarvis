import { ask, anthropicConfigured } from "./anthropic";
import {
  getBusinessCards,
  getYesterdayActivity,
  getActiveGoals,
  getDailyMetrics,
  DailyMetric,
} from "./data";
import { money } from "./format";
import { getTodayAgenda } from "./agenda";

/**
 * The shared "ask Jarvis a question" brain: one context assembly used by
 * browser voice, Slack conversations, and anything else that needs a
 * grounded answer about the businesses.
 */

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

async function buildContext(): Promise<string> {
  const [cards, activity, goals, daily, agenda] = await Promise.all([
    getBusinessCards(),
    getYesterdayActivity(),
    getActiveGoals(),
    getDailyMetrics(60),
    getTodayAgenda(),
  ]);

  const agendaLines = [
    ...agenda.events.map((e) => `- ${e.time}: ${e.summary}`),
    ...agenda.tasks.map((t) => `- task${t.overdue ? " (OVERDUE)" : ""}: ${t.name}`),
  ].join("\n");

  const dayName = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const upcomingLines = agenda.upcoming
    .map((e) => `- ${e.date} (${dayName(e.date)}) ${e.time}: ${e.summary}`)
    .join("\n");

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

  return [
    `BUSINESSES (month-to-date):\n${businessLines || "none configured"}`,
    historySection(daily, new Map(cards.map((c) => [c.id, c.name]))),
    `WHAT JARVIS DID YESTERDAY:\n${
      activity.map((a) => `- ${a.summary}`).join("\n") || "nothing logged"
    }`,
    `ACTIVE GOALS:\n${goals.map((g: any) => `- ${g.title}`).join("\n") || "none set"}`,
    `TODAY'S CALENDAR & TASKS:\n${
      agendaLines ||
      (agenda.connected.calendar || agenda.connected.clickup
        ? "nothing scheduled or due today"
        : "no calendar or task tool connected")
    }`,
    `CALENDAR · NEXT 7 DAYS:\n${
      upcomingLines || (agenda.connected.calendar ? "no events in the next 7 days" : "no calendar connected")
    }`,
  ].join("\n\n");
}

const VOICE_STYLE = [
  "You are Jarvis, a concise personal business assistant being heard OUT LOUD.",
  "Answer in 2–5 short spoken sentences. No markdown, no bullet symbols, no headers — just natural speech.",
  "Exception: when asked for a day-by-day or week-by-week breakdown, walk through the periods briefly, one short line each, using the HISTORY data.",
  "Use the numbers provided; prefer the precomputed weekly totals over adding days yourself.",
  "If something isn't connected or has no data for a period, say so plainly and suggest connecting it.",
  "Round money to whole dollars when speaking. Be direct and useful, not chatty.",
].join(" ");

const CHAT_STYLE = [
  "You are Jarvis, a concise personal business assistant replying in Slack.",
  "Keep replies short and skimmable. Slack formatting only: *bold*, plain dashes for lists — no markdown headers or tables.",
  "Use the numbers provided; prefer the precomputed weekly totals over adding days yourself.",
  "If something isn't connected or has no data for a period, say so plainly and suggest connecting it in the Jarvis app.",
  "Round money to whole dollars. Be direct and useful, not chatty.",
].join(" ");

/** Answer a question with full business context. mode: spoken vs Slack chat. */
export async function answerQuestion(q: string, mode: "voice" | "chat"): Promise<string> {
  if (!anthropicConfigured()) {
    return "I'm not connected to Claude yet — add your ANTHROPIC_API_KEY and ask me again.";
  }
  const context = await buildContext();
  try {
    return await ask({
      system: mode === "voice" ? VOICE_STYLE : CHAT_STYLE,
      prompt: `Here is the current snapshot:\n\n${context}\n\nThe user asked: "${q}"\n\n${
        mode === "voice" ? "Answer for spoken delivery." : "Answer for Slack."
      }`,
      maxTokens: 500,
    });
  } catch (e: any) {
    return `I hit an error reaching Claude: ${e.message}`;
  }
}
