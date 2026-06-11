import Anthropic from "@anthropic-ai/sdk";
import { anthropic, defaultModel } from "./anthropic";
import { supabaseAdmin } from "./supabase";
import { getBusinessMetrics } from "./connectors";
import { listBusinesses } from "./data";
import { monthStartYmd, todayYmd, yesterdayYmd } from "./time";

/**
 * Agent execution engine.
 *
 * An agent is a plain-English job description wrapped in a harness prompt.
 * It runs as a Claude tool-use loop with access to:
 *   - the user's real business data (businesses, revenue, ad spend)
 *   - web search (Anthropic server-side tool) for research
 *   - request_approval — the ONLY path to anything that sends, posts,
 *     deletes, or spends. Those actions are queued for the owner and
 *     never executed inside the run.
 *
 * Every run is recorded in agent_runs (with step-by-step trace) and
 * summarized into activity_log so it shows up under
 * "what Jarvis did yesterday".
 */

const MAX_TURNS = 8;
const MAX_TOOL_RESULT_CHARS = 6000;

type RunContext = {
  runId: string;
  agentId: string | null;
  businessId: string | null;
  steps: any[];
  approvalsQueued: number;
};

// ── Client-side tools the model can call ─────────────────────
const CLIENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_businesses",
    description:
      "List the owner's businesses (id, name, description). Use this first to find business ids.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_metrics",
    description:
      "Get real revenue (NMI) and ad spend (Meta) for one business over a date range (YYYY-MM-DD, inclusive). Defaults to month-to-date.",
    input_schema: {
      type: "object" as const,
      properties: {
        business_id: { type: "string", description: "Business id from list_businesses" },
        since: { type: "string", description: "Start date YYYY-MM-DD (default: first of this month)" },
        until: { type: "string", description: "End date YYYY-MM-DD (default: today)" },
      },
      required: ["business_id"],
    },
  },
  {
    name: "request_approval",
    description:
      "Queue an action that would send a message, post publicly, delete something, or spend money. " +
      "It will NOT happen until the owner approves it in the app. Use this instead of claiming you did the action. " +
      "Include everything needed to execute it later in `payload` (e.g. the full drafted email, the exact budget change).",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["send", "post", "delete", "spend", "other"] },
        title: { type: "string", description: "One-line description shown to the owner" },
        detail: { type: "string", description: "Full context: what, why, expected outcome" },
        amount_cents: { type: "number", description: "For 'spend': the amount in cents" },
        payload: { type: "object", description: "Machine-usable details to execute on approval" },
      },
      required: ["kind", "title"],
    },
  },
];

// Server-side web search — executed by the Anthropic API itself.
// (Typed loosely because the installed SDK predates this tool's typings.)
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
} as any;

async function execTool(name: string, input: any, ctx: RunContext): Promise<unknown> {
  const db = supabaseAdmin();

  if (name === "list_businesses") {
    const businesses = await listBusinesses(true);
    return businesses.map((b) => ({ id: b.id, name: b.name, description: b.description }));
  }

  if (name === "get_metrics") {
    const range = {
      since: String(input.since || monthStartYmd()),
      until: String(input.until || todayYmd()),
    };
    const m = await getBusinessMetrics(String(input.business_id), range);
    return {
      range,
      revenue_dollars: +(m.revenueCents / 100).toFixed(2),
      ad_spend_dollars: +(m.adSpendCents / 100).toFixed(2),
      net_dollars: +((m.revenueCents - m.adSpendCents) / 100).toFixed(2),
      revenue_by_day: m.revenueByDay.map((d) => ({ date: d.date, dollars: +(d.cents / 100).toFixed(2) })),
      spend_by_day: m.spendByDay.map((d) => ({ date: d.date, dollars: +(d.cents / 100).toFixed(2) })),
      connected: m.connected,
      errors: m.errors,
    };
  }

  if (name === "request_approval") {
    const kind = ["send", "post", "delete", "spend", "other"].includes(input.kind) ? input.kind : "other";
    const { data, error } = await db
      .from("approvals")
      .insert({
        kind,
        title: String(input.title || "Untitled action").slice(0, 300),
        detail: input.detail ? String(input.detail) : null,
        amount_cents: typeof input.amount_cents === "number" ? Math.round(input.amount_cents) : null,
        payload: input.payload && typeof input.payload === "object" ? input.payload : {},
        agent_id: ctx.agentId,
        agent_run_id: ctx.runId,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    ctx.approvalsQueued++;
    return {
      ok: true,
      approval_id: data.id,
      note: "Queued for the owner. Do NOT treat this action as done — it runs only if approved.",
    };
  }

  return { ok: false, error: `unknown tool: ${name}` };
}

function harnessPrompt(name: string, jobDescription: string): string {
  return [
    `You are "${name}", an autonomous agent working for the owner of several small businesses.`,
    "",
    "YOUR JOB (written by the owner in their own words):",
    jobDescription.trim(),
    "",
    "HOW YOU OPERATE:",
    "- Use list_businesses / get_metrics for real numbers. Never invent figures.",
    "- Use web_search when the job needs outside information or research.",
    "- You can NEVER directly send, post, delete, or spend. For any such action, call request_approval with a fully-prepared draft/plan, and clearly report it as 'queued for approval' — not done.",
    "- Be concrete and brief. Prefer doing the work over describing the work.",
    "- Finish with a short report of what you found/did, in plain language, as if leaving a note for the owner.",
    `- Today is ${todayYmd()}; yesterday was ${yesterdayYmd()}.`,
  ].join("\n");
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export type RunOutcome = {
  runId: string;
  status: "succeeded" | "failed" | "awaiting_approval";
  summary: string;
  approvalsQueued: number;
};

/** Core loop shared by persistent agents and ad-hoc (goal suggestion) jobs. */
async function executeJob(opts: {
  agentId: string | null;
  businessId: string | null;
  name: string;
  jobDescription: string;
  trigger: "manual" | "schedule" | "goal";
  label?: string;
}): Promise<RunOutcome> {
  const db = supabaseAdmin();

  const { data: run, error: runErr } = await db
    .from("agent_runs")
    .insert({
      agent_id: opts.agentId,
      trigger: opts.trigger,
      status: "running",
      label: opts.label || opts.name,
    })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`could not create run: ${runErr?.message}`);

  const ctx: RunContext = {
    runId: run.id,
    agentId: opts.agentId,
    businessId: opts.businessId,
    steps: [],
    approvalsQueued: 0,
  };

  let summary = "";
  let status: RunOutcome["status"] = "succeeded";

  try {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Run your job now. Work step by step with your tools, then leave your final report." },
    ];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await anthropic().messages.create({
        model: defaultModel(),
        max_tokens: 3000,
        system: harnessPrompt(opts.name, opts.jobDescription),
        tools: [...CLIENT_TOOLS, WEB_SEARCH_TOOL],
        messages,
      });

      messages.push({ role: "assistant", content: res.content });

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        summary = textOf(res.content) || summary || "(no report)";
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let output: unknown;
        try {
          output = await execTool(tu.name, tu.input, ctx);
        } catch (e: any) {
          output = { ok: false, error: e.message };
        }
        const outStr = JSON.stringify(output);
        ctx.steps.push({
          turn,
          tool: tu.name,
          input: tu.input,
          output: outStr.length > MAX_TOOL_RESULT_CHARS ? outStr.slice(0, MAX_TOOL_RESULT_CHARS) + "…" : JSON.parse(outStr),
        });
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: outStr.slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }
      messages.push({ role: "user", content: results });

      if (turn === MAX_TURNS - 1) {
        summary = "Hit the step limit before finishing; partial work recorded in the run trace.";
      }
    }

    if (ctx.approvalsQueued > 0) status = "awaiting_approval";
  } catch (e: any) {
    status = "failed";
    summary = `Run failed: ${e.message}`;
  }

  await db
    .from("agent_runs")
    .update({
      status,
      summary: summary.slice(0, 4000),
      steps: ctx.steps,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  if (opts.agentId) {
    await db.from("agents").update({ last_run_at: new Date().toISOString() }).eq("id", opts.agentId);
  }

  await db.from("activity_log").insert({
    type: "agent_run",
    business_id: opts.businessId,
    agent_id: opts.agentId,
    agent_run_id: run.id,
    summary:
      status === "failed"
        ? `${opts.name} failed: ${summary.slice(0, 200)}`
        : `${opts.name}: ${summary.slice(0, 300)}${ctx.approvalsQueued ? ` (${ctx.approvalsQueued} action${ctx.approvalsQueued === 1 ? "" : "s"} awaiting your approval)` : ""}`,
    meta: { trigger: opts.trigger, approvals_queued: ctx.approvalsQueued },
  });

  return { runId: run.id, status, summary, approvalsQueued: ctx.approvalsQueued };
}

/** Run a saved agent by id. */
export async function runAgent(agentId: string, trigger: "manual" | "schedule"): Promise<RunOutcome> {
  const db = supabaseAdmin();
  const { data: agent } = await db.from("agents").select("*").eq("id", agentId).single();
  if (!agent) throw new Error("agent not found");
  return executeJob({
    agentId: agent.id,
    businessId: agent.business_id,
    name: agent.name,
    jobDescription: agent.system_prompt || agent.description || "",
    trigger,
  });
}

/** Run a one-off job (e.g. an approved goal suggestion) with no saved agent. */
export async function runAdhocJob(title: string, jobSpec: string): Promise<RunOutcome> {
  return executeJob({
    agentId: null,
    businessId: null,
    name: title,
    jobDescription: jobSpec,
    trigger: "goal",
    label: title,
  });
}
