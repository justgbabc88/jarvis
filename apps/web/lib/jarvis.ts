import Anthropic from "@anthropic-ai/sdk";
import { anthropic, defaultModel, anthropicConfigured } from "./anthropic";
import { supabaseAdmin } from "./supabase";
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

// ── Safe admin tools ─────────────────────────────────────────
// Conversational Jarvis can reconfigure the app — rename things, add
// businesses/trackers, log tracker values. Deliberately excluded:
// deleting anything, touching credentials, and anything that sends,
// posts, or spends (that stays behind the approval gate).
const ADMIN_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_config",
    description:
      "Current app configuration: businesses, connections (labels only, never credentials), and trackers with ids. Call before renaming so you use the right id.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "rename_connection",
    description: "Change a connection's display label (credentials are untouched).",
    input_schema: {
      type: "object" as const,
      properties: {
        connection_id: { type: "string" },
        new_label: { type: "string" },
      },
      required: ["connection_id", "new_label"],
    },
  },
  {
    name: "rename_business",
    description: "Rename a business.",
    input_schema: {
      type: "object" as const,
      properties: {
        business_id: { type: "string" },
        new_name: { type: "string" },
      },
      required: ["business_id", "new_name"],
    },
  },
  {
    name: "create_business",
    description: "Add a new business to the dashboard.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_tracker",
    description: "Create a daily tracker (daily Slack prompt + dashboard totals).",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        question: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "log_tracker",
    description: "Log today's value for a tracker (e.g. the user says 'log 40 cold outreach').",
    input_schema: {
      type: "object" as const,
      properties: {
        tracker_id: { type: "string", description: "From list_config" },
        value: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD, default today" },
      },
      required: ["tracker_id", "value"],
    },
  },
];

async function execAdminTool(name: string, input: any): Promise<unknown> {
  const db = supabaseAdmin();
  const logChange = (summary: string) =>
    db.from("activity_log").insert({ type: "config", summary, meta: { via: "chat" } });

  if (name === "list_config") {
    const [{ data: businesses }, { data: connections }] = await Promise.all([
      db.from("businesses").select("id, name, is_active").order("created_at"),
      db.from("connections").select("id, provider, label, status").order("created_at"),
    ]);
    const { listTrackersWithStats } = await import("./trackers");
    const trackers = await listTrackersWithStats(true).catch(() => []);
    return { businesses, connections, trackers };
  }

  if (name === "rename_connection") {
    const { data, error } = await db
      .from("connections")
      .update({ label: String(input.new_label).slice(0, 120) })
      .eq("id", String(input.connection_id))
      .select("label")
      .single();
    if (error) return { ok: false, error: error.message };
    await logChange(`Renamed a connection to “${data.label}” (via chat).`);
    return { ok: true, label: data.label };
  }

  if (name === "rename_business") {
    const { data, error } = await db
      .from("businesses")
      .update({ name: String(input.new_name).slice(0, 120) })
      .eq("id", String(input.business_id))
      .select("name")
      .single();
    if (error) return { ok: false, error: error.message };
    await logChange(`Renamed a business to “${data.name}” (via chat).`);
    return { ok: true, name: data.name };
  }

  if (name === "create_business") {
    const { data, error } = await db
      .from("businesses")
      .insert({ name: String(input.name).slice(0, 120), description: input.description || null })
      .select("id, name")
      .single();
    if (error) return { ok: false, error: error.message };
    await logChange(`Added business “${data.name}” (via chat).`);
    return { ok: true, id: data.id, name: data.name };
  }

  if (name === "create_tracker") {
    const { createTracker } = await import("./trackers");
    const t = await createTracker({
      name: String(input.name),
      question: input.question ? String(input.question) : undefined,
    });
    return { ok: true, tracker_id: t.id, name: t.name };
  }

  if (name === "log_tracker") {
    const { logTrackerEntry } = await import("./trackers");
    await logTrackerEntry(String(input.tracker_id), Number(input.value), {
      date: input.date ? String(input.date) : undefined,
    });
    await logChange(`Logged ${input.value} on a tracker (via chat).`);
    return { ok: true };
  }

  return { ok: false, error: `unknown tool: ${name}` };
}

const ADMIN_RULES = [
  "You can make configuration changes with your tools when the user asks: rename businesses/connections, add businesses, create trackers, log tracker values.",
  "Call list_config first to find the right id; confirm what you changed in your reply.",
  "You can NOT delete anything, edit credentials, send, post, or spend from chat — for those, point the user to the Jarvis app (deletes/credentials) or remind them that agents queue such actions for approval.",
].join(" ");

/** Answer a question with full business context. mode: spoken vs Slack chat. */
export async function answerQuestion(q: string, mode: "voice" | "chat"): Promise<string> {
  if (!anthropicConfigured()) {
    return "I'm not connected to Claude yet — add your ANTHROPIC_API_KEY and ask me again.";
  }
  const context = await buildContext();
  const system = `${mode === "voice" ? VOICE_STYLE : CHAT_STYLE} ${ADMIN_RULES}`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Here is the current snapshot:\n\n${context}\n\nThe user asked: "${q}"\n\n${
        mode === "voice" ? "Answer for spoken delivery." : "Answer for Slack."
      }`,
    },
  ];

  try {
    for (let turn = 0; turn < 5; turn++) {
      const res = await anthropic().messages.create({
        model: defaultModel(),
        max_tokens: 800,
        system,
        tools: ADMIN_TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: res.content });

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        return (
          res.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim() || "(no answer)"
        );
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let out: unknown;
        try {
          out = await execAdminTool(tu.name, tu.input);
        } catch (e: any) {
          out = { ok: false, error: e.message };
        }
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(out).slice(0, 4000),
        });
      }
      messages.push({ role: "user", content: results });
    }
    return "I ran out of steps before finishing — the changes so far are saved; ask me to continue.";
  } catch (e: any) {
    return `I hit an error reaching Claude: ${e.message}`;
  }
}
