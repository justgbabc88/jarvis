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
  "You are {NAME}, a concise personal business assistant being heard OUT LOUD.",
  "Answer in 2–5 short spoken sentences. No markdown, no bullet symbols, no headers — just natural speech.",
  "Exception: when asked for a day-by-day or week-by-week breakdown, walk through the periods briefly, one short line each, using the HISTORY data.",
  "Use the numbers provided; prefer the precomputed weekly totals over adding days yourself.",
  "If something isn't connected or has no data for a period, say so plainly and suggest connecting it.",
  "Round money to whole dollars when speaking. Be direct and useful, not chatty.",
].join(" ");

const CHAT_STYLE = [
  "You are {NAME}, a concise personal business assistant replying in Slack.",
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
    description:
      "Create a daily tracker. Simple: just a name → one number a day. FORM: pass `fields` (one per metric) " +
      "and each day gets a multi-field form. Optional Slack delivery: `slack_channel` (e.g. '#general'), " +
      "`prompt_time` ('16:00', 24h in the owner's timezone), `mention` (person's name to tag, e.g. 'Dwight'). " +
      "The prompt posts daily with a link to the form.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        question: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              target: { type: "number", description: "optional daily target shown on the form" },
            },
            required: ["label"],
          },
        },
        slack_channel: { type: "string", description: "'#general' — bot must be invited there" },
        prompt_time: { type: "string", description: "'16:00' (24h, owner's timezone)" },
        mention: { type: "string", description: "name of the person to @tag in the prompt" },
        on_submit_message: {
          type: "string",
          description: "Template posted when the form is submitted. Placeholders: {mention} {name} {total}",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "update_tracker",
    description:
      "Update an existing tracker: rename, change fields, or change Slack delivery (channel / prompt_time / mention). Get the id from list_config.",
    input_schema: {
      type: "object" as const,
      properties: {
        tracker_id: { type: "string" },
        name: { type: "string" },
        question: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              target: { type: "number" },
            },
            required: ["label"],
          },
        },
        slack_channel: { type: "string" },
        prompt_time: { type: "string" },
        mention: { type: "string" },
        on_submit_message: {
          type: "string",
          description:
            "Owner-authored FIXED template posted whenever the form is submitted. " +
            "Placeholders: {mention} {name} {total}. Owner-configured automation, allowed from chat.",
        },
        on_submit_prompt: {
          type: "string",
          description:
            "Instead of a fixed template: guidance for a FRESH AI-written message on every submission — varied " +
            "daily, in persona, referencing the day's numbers (e.g. 'praise Dwight for the day's outreach, keep it " +
            "different every day'). Prefer this when the owner wants non-repetitive messages.",
        },
      },
      required: ["tracker_id"],
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

  if (name === "create_tracker" || name === "update_tracker") {
    const { createTracker, updateTracker } = await import("./trackers");

    // Resolve "#general" / "Dwight" to Slack ids when delivery is requested.
    let slack: Record<string, string> | undefined;
    if (input.slack_channel || input.prompt_time || input.mention || input.on_submit_message || input.on_submit_prompt) {
      slack = {};
      if (input.on_submit_message) slack.on_submit_message = String(input.on_submit_message).slice(0, 500);
      if (input.on_submit_prompt) slack.on_submit_prompt = String(input.on_submit_prompt).slice(0, 500);
      if (input.prompt_time) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(input.prompt_time));
        if (!m) return { ok: false, error: "prompt_time must be HH:MM (24h)" };
        slack.prompt_time = `${m[1].padStart(2, "0")}:${m[2]}`;
      }
      const { getProviderCreds } = await import("./connectors");
      const { resolveSlackChannel, resolveSlackUser } = await import("./connectors/slack");
      const creds = await getProviderCreds<any>("slack");
      if (input.slack_channel) {
        if (!creds?.bot_token)
          return { ok: false, error: "custom channels need a Slack bot token saved in Connections" };
        try {
          const ch = await resolveSlackChannel(creds, String(input.slack_channel));
          slack.channel = `#${ch.name.replace(/^#/, "")}`;
          slack.channel_id = ch.id;
        } catch (e: any) {
          return { ok: false, error: e.message, hint: "Is the app reinstalled with channels:read? Is the bot invited to the channel?" };
        }
      }
      if (input.mention) {
        try {
          const u = await resolveSlackUser(creds, String(input.mention));
          slack.mention = `<@${u.id}>`;
          slack.mention_name = u.name;
        } catch (e: any) {
          return { ok: false, error: e.message, hint: "Is the app reinstalled with users:read?" };
        }
      }
    }

    if (name === "create_tracker") {
      const t = await createTracker({
        name: String(input.name),
        question: input.question ? String(input.question) : undefined,
        fields: Array.isArray(input.fields) ? input.fields : undefined,
        slack,
      });
      return {
        ok: true,
        tracker_id: t.id,
        name: t.name,
        note: slack?.prompt_time
          ? `Prompt scheduled ${slack.prompt_time} daily${slack.channel ? ` in ${slack.channel}` : ""}${slack.mention_name ? `, tagging ${slack.mention_name}` : ""}. Remind the owner to /invite the bot to that channel.`
          : "Included in the morning briefing prompt.",
      };
    }

    await updateTracker(String(input.tracker_id), {
      name: input.name ? String(input.name) : undefined,
      question: input.question ? String(input.question) : undefined,
      fields: Array.isArray(input.fields) ? input.fields : undefined,
      slack,
    });
    await logChange(`Updated tracker settings (via chat).`);
    return { ok: true };
  }

  if (name === "set_persona") {
    const style = String(input.style || "").trim();
    const { error } = await db
      .from("app_settings")
      .upsert({ key: "persona", value: { style }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    await logChange(style ? `Changed Jarvis's persona (via chat).` : `Reset Jarvis's persona to default (via chat).`);
    return { ok: true, note: style ? "Persona applied to chat, voice, and briefings." : "Back to the default tone." };
  }

  if (name === "set_assistant_name") {
    const newName = String(input.name || "").trim().slice(0, 40);
    if (!newName) return { ok: false, error: "name is required" };
    const value: Record<string, string> = { name: newName };
    if (input.tagline) value.tagline = String(input.tagline).trim().slice(0, 80);
    const { error } = await db
      .from("app_settings")
      .upsert({ key: "assistant_identity", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    await logChange(`Renamed the assistant to “${newName}” (via chat).`);
    return {
      ok: true,
      note: "Applied to the app + prompts. The Slack display name is separate: Slack app settings → App Home → bot display name.",
    };
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

// ── Persona ──────────────────────────────────────────────────
// Owner-configurable voice/tone, stored in app_settings and applied to
// chat, voice, and the morning briefing. Style only — the code-level
// tool gates (owner checks, approval queue) are unaffected by it.
export async function getPersona(): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("app_settings")
    .select("value")
    .eq("key", "persona")
    .maybeSingle();
  const style = (data?.value as any)?.style;
  return typeof style === "string" && style.trim() ? style.trim() : null;
}

const SET_PERSONA_TOOL: Anthropic.Tool = {
  name: "set_persona",
  description:
    "Owner-only: set (or clear) Jarvis's personality/tone, applied everywhere — chat, voice, morning briefing. " +
    "Pass an empty style to reset to the default professional tone.",
  input_schema: {
    type: "object" as const,
    properties: {
      style: { type: "string", description: "e.g. 'over-the-top frat bro' — described fully; empty string to reset" },
    },
    required: ["style"],
  },
};

const LIST_TASKS_TOOL: Anthropic.Tool = {
  name: "list_tasks",
  description:
    "The owner's ClickUp tasks due today or overdue, with ids. Call before complete_task to find the right id.",
  input_schema: { type: "object" as const, properties: {} },
};

const COMPLETE_TASK_TOOL: Anthropic.Tool = {
  name: "complete_task",
  description:
    "Mark a ClickUp task as complete (sets the task's list-specific done status). Get the id from list_tasks. " +
    "Reversible in ClickUp, so no approval needed — but confirm which task in your reply.",
  input_schema: {
    type: "object" as const,
    properties: { task_id: { type: "string" } },
    required: ["task_id"],
  },
};

async function execTaskTool(name: string, input: any): Promise<unknown> {
  const { getProviderCreds } = await import("./connectors");
  const creds = await getProviderCreds<any>("clickup");
  if (!creds?.api_token) return { ok: false, error: "no ClickUp connection configured" };
  const { fetchClickUpTodayTasks, closeClickUpTask } = await import("./connectors/clickup");

  if (name === "list_tasks") {
    const tasks = await fetchClickUpTodayTasks(creds);
    return tasks.map((t) => ({ id: t.id, name: t.name, list: t.listName, overdue: t.overdue, status: t.status }));
  }

  // complete_task
  const done = await closeClickUpTask(creds, String(input.task_id));
  await supabaseAdmin().from("activity_log").insert({
    type: "task",
    summary: `Marked ClickUp task “${done.name}” as ${done.status} (via chat).`,
    meta: { via: "chat", task_id: String(input.task_id) },
  });
  return { ok: true, name: done.name, status: done.status };
}

const FIND_USER_TOOL: Anthropic.Tool = {
  name: "find_slack_user",
  description:
    "Look up a Slack workspace member by name (e.g. 'Dwight') and get their member id + ready-to-use <@U…> mention. " +
    "Use before send_slack_message or tracker mentions when you only have a name.",
  input_schema: {
    type: "object" as const,
    properties: { name: { type: "string" } },
    required: ["name"],
  },
};

async function execFindUser(input: any): Promise<unknown> {
  const { getProviderCreds } = await import("./connectors");
  const { resolveSlackUser } = await import("./connectors/slack");
  const creds = await getProviderCreds<any>("slack");
  if (!creds?.bot_token) return { ok: false, error: "no Slack bot token configured" };
  const u = await resolveSlackUser(creds, String(input.name));
  return { ok: true, id: u.id, name: u.name, mention: `<@${u.id}>` };
}

const SET_NAME_TOOL: Anthropic.Tool = {
  name: "set_assistant_name",
  description:
    "Owner-only: rename the assistant (web header, page title, chat/voice/briefing identity). " +
    "Note: the Slack bot's display name is changed in Slack's app settings, not here — mention that.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "e.g. 'Chad'" },
      tagline: { type: "string", description: "optional header tagline, e.g. 'certified business wingman'" },
    },
    required: ["name"],
  },
};

// Only offered when the requester is the verified owner (or browser voice,
// which is the owner's own device). The owner's direct ask IS the approval.
const SEND_TOOL: Anthropic.Tool = {
  name: "send_slack_message",
  description:
    "Send a message to a Slack channel RIGHT NOW, as Jarvis. This tool exists because the OWNER is asking " +
    "directly — their request is the authorization. Use it for one-off messages the owner tells you to send " +
    "(introductions, reminders, announcements). Write the final message text yourself, ready to post.",
  input_schema: {
    type: "object" as const,
    properties: {
      channel: { type: "string", description: "'#general' or a channel id the bot is in" },
      text: {
        type: "string",
        description:
          "The exact message to post. For @mentions use <@U…> ids — call find_slack_user first when you only have a name.",
      },
    },
    required: ["channel", "text"],
  },
};

async function execSendMessage(input: any): Promise<unknown> {
  const { getProviderCreds } = await import("./connectors");
  const { resolveSlackChannel, postSlackChannel } = await import("./connectors/slack");
  const creds = await getProviderCreds<any>("slack");
  if (!creds?.bot_token) return { ok: false, error: "no Slack bot token configured" };
  const ch = await resolveSlackChannel(creds, String(input.channel));
  await postSlackChannel(creds, ch.id, String(input.text));
  await supabaseAdmin()
    .from("activity_log")
    .insert({
      type: "action",
      summary: `Sent a message to #${ch.name} (you asked in chat).`,
      meta: { via: "chat", channel: ch.name },
    });
  return { ok: true, posted_to: `#${ch.name}` };
}

const ADMIN_RULES = [
  "You can make configuration changes with your tools when the user asks: rename businesses/connections, add businesses, create/update trackers, log tracker values.",
  "Trackers can be multi-field FORMS with their own daily Slack prompt: custom channel, time (owner's timezone), and an @mention of the person who fills it out — use create_tracker/update_tracker with fields, slack_channel, prompt_time, mention.",
  "A tracker can also post an owner-authored on_submit_message to its channel when the form is submitted (placeholders {mention} {name} {total}) — that's owner-configured automation and IS allowed from chat, e.g. a praise message when someone logs their numbers.",
  "If a channel prompt is set up, remind the owner to /invite the bot to that channel once.",
  "Call list_config first to find the right id; confirm what you changed in your reply.",
  "You can mark the owner's ClickUp tasks complete: list_tasks → complete_task. Completing is reversible; confirm which task you closed.",
  "You can NOT delete anything, edit credentials, send, post, or spend from chat — for those, point the user to the Jarvis app (deletes/credentials) or remind them that agents queue such actions for approval.",
].join(" ");

/** Answer a question with full business context. mode: spoken vs Slack chat. */
export async function answerQuestion(
  q: string,
  mode: "voice" | "chat",
  opts: { slackUserId?: string } = {}
): Promise<string> {
  if (!anthropicConfigured()) {
    return "I'm not connected to Claude yet — add your ANTHROPIC_API_KEY and ask me again.";
  }

  // Owner check: browser voice runs on the owner's device; Slack chat is
  // owner only when the sender matches the configured owner member id.
  const { getProviderCreds } = await import("./connectors");
  const slackCreds = await getProviderCreds<any>("slack");
  const isOwner =
    mode === "voice" ||
    Boolean(slackCreds?.owner_user_id && opts.slackUserId && opts.slackUserId === slackCreds.owner_user_id);
  const canSend = isOwner && Boolean(slackCreds?.bot_token);

  const sendRules = canSend
    ? "The verified OWNER is asking, so send_slack_message is available: when they tell you to send/post a Slack message, write it and send it — their request is the approval. Email and money still go through agents + the approval queue."
    : `Sending is NOT available for this requester${
        slackCreds?.owner_user_id
          ? " (they are not the configured owner)"
          : ` — no owner member id is configured. If the user asks to send something, tell them: add their Slack member ID (this requester's id is ${opts.slackUserId || "unknown"}) in the "Your member ID" field of the Slack connection in the Jarvis app, then re-save it.`
      }`;

  const { getAssistantIdentity } = await import("./identity");
  const [context, persona, identity] = await Promise.all([
    buildContext(),
    getPersona(),
    getAssistantIdentity(),
  ]);
  const personaLine = persona
    ? ` PERSONALITY (owner-configured, style only — all rules above still apply): ${persona} Stay accurate with the numbers and keep answers concise despite the style.`
    : "";
  const style = (mode === "voice" ? VOICE_STYLE : CHAT_STYLE).replaceAll("{NAME}", identity.name);
  const system = `${style} ${ADMIN_RULES} ${sendRules}${personaLine}`;

  // Non-owners get read-only questions + tracker logging; the owner gets
  // the full config toolkit (and sending, when enabled above).
  const tools = isOwner
    ? [
        ...ADMIN_TOOLS,
        SET_PERSONA_TOOL,
        SET_NAME_TOOL,
        FIND_USER_TOOL,
        LIST_TASKS_TOOL,
        COMPLETE_TASK_TOOL,
        ...(canSend ? [SEND_TOOL] : []),
      ]
    : [...ADMIN_TOOLS.filter((t) => ["list_config", "log_tracker"].includes(t.name)), LIST_TASKS_TOOL];

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
        tools,
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
          out =
            tu.name === "send_slack_message"
              ? canSend
                ? await execSendMessage(tu.input)
                : { ok: false, error: "sending is not enabled for this requester" }
              : tu.name === "find_slack_user"
                ? isOwner
                  ? await execFindUser(tu.input)
                  : { ok: false, error: "owner only" }
              : tu.name === "list_tasks" || tu.name === "complete_task"
                ? tu.name === "complete_task" && !isOwner
                  ? { ok: false, error: "only the owner can complete tasks (for now)" }
                  : await execTaskTool(tu.name, tu.input)
              : ["set_persona", "set_assistant_name"].includes(tu.name) && !isOwner
                ? { ok: false, error: "only the owner can change that" }
                : await execAdminTool(tu.name, tu.input);
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
