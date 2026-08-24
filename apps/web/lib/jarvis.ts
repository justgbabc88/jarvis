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

// Token economy: the default context is the LIGHT snapshot only. The
// 60-day daily/weekly history that used to ride along on every message
// (even banter) now lives behind the get_history tool.
async function buildContext(): Promise<string> {
  const [cards, activity, goals, agenda] = await Promise.all([
    getBusinessCards(),
    getYesterdayActivity(),
    getActiveGoals(),
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
    "DAILY/WEEKLY HISTORY: not loaded — call get_history when the question involves trends, specific days/weeks, or comparisons over time.",
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

/** Limited context for non-owner team members: trackers + tasks only. */
async function buildTeamContext(): Promise<string> {
  const { listTrackersWithStats } = await import("./trackers");
  const [agenda, trackers] = await Promise.all([
    getTodayAgenda(),
    listTrackersWithStats(true).catch(() => []),
  ]);
  const trackerLines =
    trackers
      .map(
        (t) =>
          `- ${t.name}: today ${t.today ?? "not logged yet"}, last 7 days ${t.last7}, all-time ${t.total}`
      )
      .join("\n") || "no trackers set up";
  const taskLines =
    agenda.tasks
      .map((t) => `- ${t.name}${t.overdue ? " (OVERDUE)" : ""}${t.listName ? ` [${t.listName}]` : ""}`)
      .join("\n") || "nothing due today";
  return `DAILY TRACKERS (team outreach stats):\n${trackerLines}\n\nCLICKUP TASKS DUE TODAY / OVERDUE:\n${taskLines}`;
}

const TEAM_SCOPE_RULES =
  " You are talking to a TEAM MEMBER, not the owner. You may ONLY discuss daily tracker stats and ClickUp tasks. " +
  "If asked about revenue, ad spend, businesses, goals, the calendar, approvals, or configuration, decline warmly and " +
  "say that's for the owner. Never reveal financial numbers to team members — you have not been given them.";

const BANTER_RULE =
  " STRICT RULE on numbers: include financial figures, stats, or business summaries ONLY when the user's message " +
  "explicitly asks about numbers, stats, performance, revenue, spend, or a specific business. Everything else — " +
  "greetings, banter, hype/motivation requests ('get me hyped', 'pump me up'), thanks, jokes — gets a short in-kind " +
  "reply with ZERO metrics and no unrequested suggestions. Hype without stats is pure energy, not a report.";

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

const GET_AD_PERFORMANCE_TOOL: Anthropic.Tool = {
  name: "get_ad_performance",
  description:
    "Meta ads performance per campaign or per adset: spend, leads, CPL, CTR, frequency, with ids. " +
    "Call for questions about which campaigns/adsets are working, CPL, ad fatigue, or before proposing " +
    "budget changes (the adset ids here are what a meta.budget_update action executes against).",
  input_schema: {
    type: "object" as const,
    properties: {
      level: { type: "string", enum: ["campaign", "adset"], description: "default campaign" },
      days: { type: "number", description: "How many days back (default 14, max 60)" },
    },
  },
};

export async function execGetAdPerformance(input: any): Promise<string> {
  const { getProviderCreds } = await import("./connectors");
  const { metaCredsFromEnv, fetchMetaCampaignInsights, insightsToText } = await import(
    "./connectors/meta"
  );
  const creds = (await getProviderCreds<any>("meta")) || metaCredsFromEnv();
  if (!creds) return "No Meta connection configured — add one in Connections.";
  const days = Math.min(Math.max(Number(input?.days) || 14, 1), 60);
  const level = input?.level === "adset" ? "adset" : "campaign";
  const { nDaysAgoYmd, todayYmd } = await import("./time");
  const range = { since: nDaysAgoYmd(days), until: todayYmd() };
  const rows = await fetchMetaCampaignInsights(creds, range, level);
  return insightsToText(rows, level, range);
}

const GET_FUNNEL_TOOL: Anthropic.Tool = {
  name: "get_funnel",
  description:
    "GoHighLevel pipeline funnel: opportunities created, open per stage with dollar values, wins and " +
    "losses in the range. Call for questions about leads, pipeline, booked/closed deals, or conversion.",
  input_schema: {
    type: "object" as const,
    properties: {
      days: { type: "number", description: "How many days back (default 30, max 90)" },
    },
  },
};

export async function execGetFunnel(input: any): Promise<string> {
  const { getProviderCreds } = await import("./connectors");
  const { fetchGhlFunnel, funnelToText } = await import("./connectors/ghl");
  const creds = await getProviderCreds<any>("ghl");
  if (!creds) return "No GoHighLevel connection configured — add one in Connections.";
  const days = Math.min(Math.max(Number(input?.days) || 30, 7), 90);
  const { nDaysAgoYmd, todayYmd } = await import("./time");
  const range = { since: nDaysAgoYmd(days), until: todayYmd() };
  const funnel = await fetchGhlFunnel(creds, range);
  return funnelToText(funnel, range);
}

const GET_STALE_DEALS_TOOL: Anthropic.Tool = {
  name: "get_stale_deals",
  description:
    "Open GHL opportunities untouched for N+ days, with pipeline/stage, value, days stale, and contact " +
    "name/email when available. The follow-up hit list — call before drafting chase emails.",
  input_schema: {
    type: "object" as const,
    properties: {
      days_stale: { type: "number", description: "Minimum days untouched (default 4)" },
    },
  },
};

export async function execGetStaleDeals(input: any): Promise<string> {
  const { getProviderCreds } = await import("./connectors");
  const { fetchStaleOpportunities, staleToText } = await import("./connectors/ghl");
  const creds = await getProviderCreds<any>("ghl");
  if (!creds) return "No GoHighLevel connection configured — add one in Connections.";
  const days = Math.min(Math.max(Number(input?.days_stale) || 4, 1), 60);
  const rows = await fetchStaleOpportunities(creds, days);
  return staleToText(rows, days);
}

const LEAD_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_leads",
    description:
      "The owner's saved leads (from prospecting agents), newest first, with status and the drafted opener. " +
      "Use for 'how many leads', 'what's new', 'who haven't we contacted', or to read an opener aloud.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description: "Filter: new | contacted | replied | booked | won | dead | all (default new)",
        },
        limit: { type: "number", description: "default 20, max 100" },
      },
    },
  },
  {
    name: "save_leads",
    description:
      "Add prospects to the Leads list (deduped by business name + city). Use when the owner gives you " +
      "prospects to record, or when you research some yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        leads: {
          type: "array",
          items: {
            type: "object",
            properties: {
              business_name: { type: "string" },
              trade: { type: "string" },
              city: { type: "string" },
              pain: { type: "string" },
              channel: { type: "string" },
              contact: { type: "string" },
              opener: { type: "string" },
            },
            required: ["business_name"],
          },
        },
      },
      required: ["leads"],
    },
  },
  {
    name: "update_lead",
    description:
      "Change a lead's status (new | contacted | replied | booked | won | dead) or add a note. " +
      "Use when the owner says things like 'mark Rodriguez Roofing as contacted'. Get ids from get_leads.",
    input_schema: {
      type: "object" as const,
      properties: {
        lead_id: { type: "string" },
        status: { type: "string" },
        notes: { type: "string" },
      },
      required: ["lead_id"],
    },
  },
];

async function execLeadTool(name: string, input: any): Promise<unknown> {
  const { listLeads, saveLeads, updateLead } = await import("./leads");

  if (name === "get_leads") {
    const limit = Math.min(Math.max(Number(input?.limit) || 20, 1), 100);
    const rows = await listLeads({ status: input?.status || "new", limit });
    return rows.map((l) => ({
      id: l.id,
      business: l.business_name,
      trade: l.trade,
      city: l.city,
      pain: l.pain,
      channel: l.channel,
      contact: l.contact,
      opener: l.opener,
      status: l.status,
    }));
  }

  if (name === "save_leads") {
    const leads = Array.isArray(input?.leads) ? input.leads : [];
    if (leads.length === 0) return { ok: false, error: "leads array is required" };
    const r = await saveLeads(leads, { source: "chat" });
    return { ok: true, ...r };
  }

  // update_lead
  await updateLead(String(input.lead_id), { status: input.status, notes: input.notes });
  return { ok: true, note: "Lead updated." };
}

const OUTREACH_TOOLS: Anthropic.Tool[] = [
  {
    name: "queue_lead_emails",
    description:
      "Queue cold-outreach emails to leads for the owner's approval — NOTHING sends until they tap Approve. " +
      "Only works for leads whose contact holds an email address (call get_leads first). Write each email " +
      "yourself from the lead's evidenced pain and its saved opener: short, plain text, one specific " +
      "observation about THEIR business, one clear ask. No images, no links unless asked, no hype. " +
      "The owner's configured sign-off (business name, address, opt-out) is appended automatically on send. " +
      "Max 10 per call — cold email works in small, personal batches, not blasts.",
    input_schema: {
      type: "object" as const,
      properties: {
        emails: {
          type: "array",
          items: {
            type: "object",
            properties: {
              lead_id: { type: "string", description: "From get_leads" },
              to: { type: "string", description: "The lead's email address" },
              subject: { type: "string", description: "Short, specific, non-salesy" },
              body: { type: "string", description: "The full email text, ready to send" },
            },
            required: ["lead_id", "to", "subject", "body"],
          },
        },
      },
      required: ["emails"],
    },
  },
  {
    name: "set_outreach_footer",
    description:
      "Set the sign-off appended to every outreach email — business name, postal address, and an opt-out " +
      "line. Required before cold emails can send (CAN-SPAM). Call when the owner gives you these details.",
    input_schema: {
      type: "object" as const,
      properties: { text: { type: "string", description: "The full sign-off block" } },
      required: ["text"],
    },
  },
];

async function execOutreachTool(name: string, input: any): Promise<unknown> {
  const db = supabaseAdmin();

  if (name === "set_outreach_footer") {
    const text = String(input.text || "").trim();
    if (!text) return { ok: false, error: "text is required" };
    const { error } = await db
      .from("app_settings")
      .upsert(
        { key: "outreach_footer", value: { text }, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) return { ok: false, error: error.message };
    await db.from("activity_log").insert({
      type: "config",
      summary: "Set the outreach email sign-off (via chat).",
      meta: { via: "chat" },
    });
    return { ok: true, note: "Saved — outreach emails can now be approved and sent." };
  }

  // queue_lead_emails
  const emails = Array.isArray(input?.emails) ? input.emails.slice(0, 10) : [];
  if (emails.length === 0) return { ok: false, error: "emails array is required" };

  const { data: footerRow } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "outreach_footer")
    .maybeSingle();
  const hasFooter = Boolean((footerRow?.value as any)?.text);

  const { notifySlackApproval } = await import("./notify");
  const queued: string[] = [];
  for (const e of emails) {
    const to = String(e.to || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) continue;
    const { data, error } = await db
      .from("approvals")
      .insert({
        kind: "send",
        title: `Cold outreach: ${to}`,
        detail: String(e.subject || "").slice(0, 300),
        payload: {
          action: "email.send",
          to,
          subject: String(e.subject || ""),
          body: String(e.body || ""),
          lead_id: String(e.lead_id || ""),
        },
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) continue;
    queued.push(to);
    await notifySlackApproval({
      id: data.id,
      kind: "send",
      title: `Cold outreach: ${to}`,
      detail: String(e.subject || ""),
      amount_cents: null,
    });
  }

  return {
    ok: true,
    queued: queued.length,
    recipients: queued,
    footer_configured: hasFooter,
    note: hasFooter
      ? `${queued.length} email(s) QUEUED for approval — none sent yet. Approving each one sends it and marks the lead contacted.`
      : `${queued.length} email(s) queued, but NO SIGN-OFF IS CONFIGURED — approving them will fail until the owner provides a business name, postal address, and opt-out line for set_outreach_footer. Ask for those now.`,
  };
}

const LIST_AGENTS_TOOL: Anthropic.Tool = {
  name: "list_agents",
  description:
    "The owner's scheduled agents: id, name, what they do, cron schedule, enabled/paused, last run. " +
    "Call before pausing, resuming, or rescheduling one.",
  input_schema: { type: "object" as const, properties: {} },
};

const SET_AGENT_ENABLED_TOOL: Anthropic.Tool = {
  name: "set_agent_enabled",
  description:
    "Pause (enabled=false) or resume (enabled=true) a scheduled agent. Fully reversible — a paused " +
    "agent keeps its schedule and history, it just stops running until resumed. Get the id from list_agents.",
  input_schema: {
    type: "object" as const,
    properties: {
      agent_id: { type: "string" },
      enabled: { type: "boolean" },
    },
    required: ["agent_id", "enabled"],
  },
};

const SET_AGENT_SCHEDULE_TOOL: Anthropic.Tool = {
  name: "set_agent_schedule",
  description:
    "Change when a scheduled agent runs. Pass a 5-field cron expression evaluated in the owner's " +
    "timezone (e.g. '0 5 * * *' = 5am daily, '0 6 * * 1' = 6am Mondays).",
  input_schema: {
    type: "object" as const,
    properties: {
      agent_id: { type: "string" },
      schedule_cron: { type: "string", description: "5-field cron, owner's timezone" },
    },
    required: ["agent_id", "schedule_cron"],
  },
};

async function execAgentTool(name: string, input: any): Promise<unknown> {
  const db = supabaseAdmin();

  if (name === "list_agents") {
    const { data, error } = await db
      .from("agents")
      .select("id, name, description, schedule_cron, enabled, last_run_at")
      .order("created_at");
    if (error) return { ok: false, error: error.message };
    return data;
  }

  if (name === "set_agent_enabled") {
    const enabled = Boolean(input.enabled);
    const { data, error } = await db
      .from("agents")
      .update({ enabled })
      .eq("id", String(input.agent_id))
      .select("name, schedule_cron")
      .single();
    if (error) return { ok: false, error: error.message };
    await db.from("activity_log").insert({
      type: "config",
      summary: `${enabled ? "Resumed" : "Paused"} the “${data.name}” agent (via chat).`,
      meta: { via: "chat", agent_id: String(input.agent_id), enabled },
    });
    return {
      ok: true,
      name: data.name,
      enabled,
      note: enabled
        ? `Resumed — next run on schedule "${data.schedule_cron}".`
        : "Paused — it keeps its schedule and history but won't run until resumed.",
    };
  }

  // set_agent_schedule
  const cron = String(input.schedule_cron || "").trim();
  if (cron.split(/\s+/).length !== 5) {
    return { ok: false, error: "schedule_cron must be a 5-field cron expression, e.g. '0 5 * * *'" };
  }
  const { data, error } = await db
    .from("agents")
    .update({ schedule_cron: cron })
    .eq("id", String(input.agent_id))
    .select("name, enabled")
    .single();
  if (error) return { ok: false, error: error.message };
  await db.from("activity_log").insert({
    type: "config",
    summary: `Rescheduled the “${data.name}” agent to "${cron}" (via chat).`,
    meta: { via: "chat", agent_id: String(input.agent_id), schedule_cron: cron },
  });
  return {
    ok: true,
    name: data.name,
    schedule_cron: cron,
    note: data.enabled ? "Live on the new schedule." : "Saved — the agent is still paused.",
  };
}

const QUEUE_ACTION_TOOL: Anthropic.Tool = {
  name: "queue_action",
  description:
    "Queue an action for the owner's approval — it does NOT execute until they tap Approve (in the app " +
    "or the Slack card). Use when the owner asks you to stage a money/send action, e.g. a Meta budget " +
    "change after reviewing get_ad_performance. Executable payloads:\n" +
    '  Meta budget: { "action": "meta.budget_update", "object_type": "adset"|"campaign", "object_id": "123", "daily_budget_cents": 5000 }\n' +
    '  email:       { "action": "email.send", "to": "a@b.com", "subject": "...", "body": "full text" }\n' +
    "Always state clearly in your reply that it is QUEUED, not done.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["send", "post", "delete", "spend", "other"] },
      title: { type: "string", description: "One-line description shown to the owner" },
      detail: { type: "string", description: "Why — cite the numbers that justify it" },
      amount_cents: { type: "number" },
      payload: { type: "object", description: "Machine-executable details (runs as-is on approval)" },
    },
    required: ["kind", "title", "payload"],
  },
};

async function execQueueAction(input: any): Promise<unknown> {
  const db = supabaseAdmin();
  const kind = ["send", "post", "delete", "spend", "other"].includes(input.kind) ? input.kind : "other";
  const { data, error } = await db
    .from("approvals")
    .insert({
      kind,
      title: String(input.title || "Untitled action").slice(0, 300),
      detail: input.detail ? String(input.detail) : null,
      amount_cents: typeof input.amount_cents === "number" ? Math.round(input.amount_cents) : null,
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const { notifySlackApproval } = await import("./notify");
  await notifySlackApproval({
    id: data.id,
    kind,
    title: String(input.title || "Untitled action"),
    detail: input.detail ? String(input.detail) : null,
    amount_cents: typeof input.amount_cents === "number" ? Math.round(input.amount_cents) : null,
  });
  return {
    ok: true,
    approval_id: data.id,
    note: "Queued — an approval card was posted. It runs ONLY if the owner approves.",
  };
}

const GET_HISTORY_TOOL: Anthropic.Tool = {
  name: "get_history",
  description:
    "Daily and weekly revenue/spend history per business. Call when the question involves trends, " +
    "specific days or weeks, comparisons over time, or 'biggest/best/worst' periods.",
  input_schema: {
    type: "object" as const,
    properties: {
      days: { type: "number", description: "How many days back (default 30, max 90)" },
    },
  },
};

async function execGetHistory(input: any): Promise<string> {
  const days = Math.min(Math.max(Number(input?.days) || 30, 7), 90);
  const [cards, daily] = await Promise.all([getBusinessCards(), getDailyMetrics(days)]);
  return historySection(daily, new Map(cards.map((c) => [c.id, c.name])));
}

/**
 * Model for conversational surfaces (chat/voice), separate from agent
 * runs. Priority: app_settings 'chat_model' (changeable live, no
 * redeploy) → ANTHROPIC_CHAT_MODEL env → the main model.
 */
async function chatModel(): Promise<string> {
  try {
    const { data } = await supabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "chat_model")
      .maybeSingle();
    const m = (data?.value as any)?.model;
    if (typeof m === "string" && m.trim()) return m.trim();
  } catch {}
  return process.env.ANTHROPIC_CHAT_MODEL || defaultModel();
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
  "You can manage the owner's scheduled agents: list_agents → set_agent_enabled (pause/resume) or set_agent_schedule (change the cron). All reversible; confirm what you changed.",
  "Prospecting agents save what they find to the Leads list. Use get_leads to read it, update_lead to change a lead's status, and save_leads to add prospects. The owner can export the whole list as a CSV (a spreadsheet) from the Leads page in the app.",
  "To email leads: get_leads → queue_lead_emails (owner-only). This only QUEUES approval cards; the owner taps Approve to send, and the lead is then marked contacted automatically. Keep cold emails short, plain, and specific to that business — and keep batches small (10 or fewer at a time) to protect deliverability. If no outreach sign-off is configured, ask the owner for their business name, postal address, and opt-out line and save it with set_outreach_footer.",
  "For ad/funnel analysis use get_ad_performance (Meta campaigns/adsets: spend, CPL, CTR) and get_funnel (GHL pipeline stages, wins). When the owner asks to change a budget or stage a money/send action, use queue_action — it only QUEUES an approval card; nothing executes until the owner taps Approve. Cite the numbers that justify any queued action.",
  "You can NOT delete anything, edit credentials, send, post, or spend from chat — for those, point the user to the Jarvis app (deletes/credentials) or remind them that agents queue such actions for approval.",
].join(" ");

/** Answer a question with full business context. mode: spoken vs Slack chat. */
export async function answerQuestion(
  q: string,
  mode: "voice" | "chat",
  opts: { slackUserId?: string; audience?: "dm" | "channel" } = {}
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
  // Non-owners never receive the financial context at all — the model
  // can't leak numbers it was never given.
  const [context, persona, identity] = await Promise.all([
    isOwner ? buildContext() : buildTeamContext(),
    getPersona(),
    getAssistantIdentity(),
  ]);
  const personaLine = persona
    ? ` PERSONALITY (owner-configured, style only — all rules above still apply): ${persona} Stay accurate with the numbers and keep answers concise despite the style.`
    : "";
  const style = (mode === "voice" ? VOICE_STYLE : CHAT_STYLE).replaceAll("{NAME}", identity.name);
  const audienceLine =
    opts.audience === "channel"
      ? " AUDIENCE: you are replying in a SHARED Slack channel that the whole team reads. If the request says 'us', 'we', 'everyone', 'the team' — or is clearly meant for the group (announcements, hype speeches, kudos) — address the TEAM collectively, not just the person who asked. Only address the requester individually when the request is personal to them."
      : " AUDIENCE: this is a 1-on-1 DM — address the requester directly, except when they say 'us'/'we'/'the team', which still means write it for the whole group.";
  const system = `${style} ${ADMIN_RULES} ${sendRules}${isOwner ? "" : TEAM_SCOPE_RULES}${BANTER_RULE}${audienceLine}${personaLine}`;

  // Non-owners get read-only questions + tracker logging; the owner gets
  // the full config toolkit (and sending, when enabled above).
  // get_history is owner-only — it's financial data.
  const tools: Anthropic.Tool[] = isOwner
    ? [
        ...ADMIN_TOOLS,
        GET_HISTORY_TOOL,
        GET_AD_PERFORMANCE_TOOL,
        GET_FUNNEL_TOOL,
        GET_STALE_DEALS_TOOL,
        ...LEAD_TOOLS,
        ...OUTREACH_TOOLS,
        LIST_AGENTS_TOOL,
        SET_AGENT_ENABLED_TOOL,
        SET_AGENT_SCHEDULE_TOOL,
        QUEUE_ACTION_TOOL,
        SET_PERSONA_TOOL,
        SET_NAME_TOOL,
        FIND_USER_TOOL,
        LIST_TASKS_TOOL,
        COMPLETE_TASK_TOOL,
        ...(canSend ? [SEND_TOOL] : []),
      ]
    : [...ADMIN_TOOLS.filter((t) => ["list_config", "log_tracker"].includes(t.name)), LIST_TASKS_TOOL];

  // Prompt caching: tools + system are the stable prefix — mark them so
  // loop turns 2..5 and rapid follow-ups read them at ~10% price.
  const cachedTools = tools.map((t, i) =>
    i === tools.length - 1 ? ({ ...t, cache_control: { type: "ephemeral" } } as any) : t
  );
  const cachedSystem = [
    { type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } },
  ];
  const model = await chatModel();

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
        model,
        max_tokens: 800,
        system: cachedSystem as any,
        tools: cachedTools,
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
              : tu.name === "get_history"
                ? isOwner
                  ? await execGetHistory(tu.input)
                  : { ok: false, error: "owner only" }
              : tu.name === "get_ad_performance"
                ? isOwner
                  ? await execGetAdPerformance(tu.input)
                  : { ok: false, error: "owner only" }
              : tu.name === "get_funnel"
                ? isOwner
                  ? await execGetFunnel(tu.input)
                  : { ok: false, error: "owner only" }
              : tu.name === "get_stale_deals"
                ? isOwner
                  ? await execGetStaleDeals(tu.input)
                  : { ok: false, error: "owner only" }
              : ["get_leads", "save_leads", "update_lead"].includes(tu.name)
                ? isOwner
                  ? await execLeadTool(tu.name, tu.input)
                  : { ok: false, error: "owner only" }
              : ["queue_lead_emails", "set_outreach_footer"].includes(tu.name)
                ? isOwner
                  ? await execOutreachTool(tu.name, tu.input)
                  : { ok: false, error: "owner only" }
              : ["list_agents", "set_agent_enabled", "set_agent_schedule"].includes(tu.name)
                ? isOwner
                  ? await execAgentTool(tu.name, tu.input)
                  : { ok: false, error: "owner only" }
              : tu.name === "queue_action"
                ? isOwner
                  ? await execQueueAction(tu.input)
                  : { ok: false, error: "owner only" }
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
                : tu.name === "list_config" && !isOwner
                  ? { trackers: (await execAdminTool("list_config", {}) as any)?.trackers || [] }
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
