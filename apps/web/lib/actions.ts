import { supabaseAdmin } from "./supabase";
import { getProviderCreds } from "./connectors";
import { sendEmail, EmailCreds } from "./connectors/email";
import { postSlack, SlackCreds } from "./connectors/slack";
import { metaCredsFromEnv, MetaCreds } from "./connectors/meta";

/**
 * Action executor — the part that makes the approval gate real.
 *
 * Agents can only *queue* actions (via the request_approval tool). When
 * the owner taps Approve, the executor runs the action described in the
 * approval's `payload` and records exactly what happened.
 *
 * Supported payloads (payload.action):
 *   email.send          { to, subject, body, cc?, bcc? }
 *   slack.post          { text }
 *   meta.budget_update  { object_id, object_type: 'adset'|'campaign',
 *                         daily_budget_cents }
 *
 * Anything else is marked 'skipped' — approved in spirit, but with
 * nothing wired to execute it (the agent's draft stays in the payload
 * for you to act on manually).
 */

const GRAPH_VERSION = "v21.0";

export type ExecutionResult = {
  status: "executed" | "failed" | "skipped";
  message: string;
  detail?: Record<string, unknown>;
};

async function execEmailSend(payload: any): Promise<ExecutionResult> {
  const creds = await getProviderCreds<EmailCreds>("email");
  if (!creds) {
    return {
      status: "failed",
      message: "No email connection. Add one in Connections (SMTP host + app password), then re-approve.",
    };
  }
  let body = String(payload.body || payload.text || "");

  // Cold outreach (a lead_id is present) gets the owner's configured
  // sign-off appended — business identity, postal address, and opt-out
  // line, which CAN-SPAM requires on commercial email.
  if (payload.lead_id) {
    const { data } = await supabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "outreach_footer")
      .maybeSingle();
    const footer = (data?.value as any)?.text;
    if (typeof footer === "string" && footer.trim()) {
      body = `${body.trimEnd()}\n\n--\n${footer.trim()}`;
    } else {
      return {
        status: "failed",
        message:
          "Outreach email blocked: no sign-off configured. Ask Jarvis to 'set the outreach footer' with your business name, postal address, and an opt-out line (CAN-SPAM requires it on cold email).",
      };
    }
  }

  const res = await sendEmail(creds, {
    to: String(payload.to || ""),
    subject: String(payload.subject || ""),
    body,
    cc: payload.cc ? String(payload.cc) : undefined,
    bcc: payload.bcc ? String(payload.bcc) : undefined,
  });

  // Sending to a lead advances it on the Leads page automatically.
  if (payload.lead_id) {
    try {
      const { updateLead } = await import("./leads");
      await updateLead(String(payload.lead_id), { status: "contacted" });
    } catch (e) {
      console.error("[actions] lead status update failed:", (e as Error).message);
    }
  }

  return {
    status: "executed",
    message: `Email sent to ${payload.to}.${payload.lead_id ? " Lead marked contacted." : ""}`,
    detail: { message_id: res.messageId, accepted: res.accepted },
  };
}

async function execSlackPost(payload: any): Promise<ExecutionResult> {
  const creds = await getProviderCreds<SlackCreds>("slack");
  if (!creds) {
    return {
      status: "failed",
      message: "No Slack connection. Add one in Connections (incoming webhook URL), then re-approve.",
    };
  }
  const text = String(payload.text || "").trim();
  if (!text) return { status: "failed", message: "Payload needs `text` to post." };
  await postSlack(creds, text);
  return { status: "executed", message: "Posted to Slack." };
}

async function execMetaBudgetUpdate(payload: any): Promise<ExecutionResult> {
  const creds = (await getProviderCreds<MetaCreds>("meta")) || metaCredsFromEnv();
  if (!creds) {
    return { status: "failed", message: "No Meta connection — add one in Connections, then re-approve." };
  }
  const objectId = String(payload.object_id || payload.adset_id || payload.campaign_id || "");
  const budgetCents = Math.round(Number(payload.daily_budget_cents));
  if (!objectId || !isFinite(budgetCents) || budgetCents <= 0) {
    return {
      status: "failed",
      message: "Payload needs `object_id` (ad set or campaign id) and a positive `daily_budget_cents`.",
    };
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${objectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      daily_budget: String(budgetCents), // Meta budgets are in account-currency cents
      access_token: creds.access_token,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    return {
      status: "failed",
      message: `Meta API error: ${json.error?.message || res.status}`,
    };
  }
  return {
    status: "executed",
    message: `Daily budget on ${payload.object_type || "object"} ${objectId} set to $${(budgetCents / 100).toFixed(2)}.`,
    detail: { response: json },
  };
}

/**
 * Execute an approved approval row. Persists executed_at /
 * execution_status / execution_result on the row and logs to the
 * activity feed. Never throws.
 */
export async function executeApproval(
  approval: {
    id: string;
    title: string;
    payload: any;
    agent_id?: string | null;
    agent_run_id?: string | null;
  },
  opts: { notify?: boolean } = {}
): Promise<ExecutionResult> {
  const action = String(approval.payload?.action || "");
  let result: ExecutionResult;

  try {
    if (action === "email.send") result = await execEmailSend(approval.payload);
    else if (action === "slack.post") result = await execSlackPost(approval.payload);
    else if (action === "meta.budget_update") result = await execMetaBudgetUpdate(approval.payload);
    else {
      result = {
        status: "skipped",
        message: action
          ? `No executor for action "${action}" yet — the drafted details are saved on the approval.`
          : "Nothing executable in the payload — treat the agent's draft as a note to act on yourself.",
      };
    }
  } catch (e: any) {
    result = { status: "failed", message: e.message };
  }

  const db = supabaseAdmin();
  await db
    .from("approvals")
    .update({
      executed_at: new Date().toISOString(),
      execution_status: result.status,
      execution_result: { message: result.message, ...(result.detail || {}) },
    })
    .eq("id", approval.id);

  // Tell the owner in Slack what actually happened (skip slack.post — the
  // posted message itself is already visible in the channel — and skip
  // when the caller reports the outcome itself, e.g. the Slack buttons).
  if (opts.notify !== false && action !== "slack.post") {
    const { notifySlack } = await import("./notify");
    await notifySlack(
      result.status === "executed"
        ? `✅ Executed “${approval.title}” — ${result.message}`
        : result.status === "failed"
          ? `❌ “${approval.title}” failed to execute: ${result.message}`
          : `☑️ Approved “${approval.title}” (${result.message})`
    );
  }

  await db.from("activity_log").insert({
    type: "action",
    agent_id: approval.agent_id || null,
    agent_run_id: approval.agent_run_id || null,
    summary:
      result.status === "executed"
        ? `Executed “${approval.title}” — ${result.message}`
        : result.status === "failed"
          ? `Tried to execute “${approval.title}” but it failed: ${result.message}`
          : `Approved “${approval.title}” (${result.message})`,
    meta: { approval_id: approval.id, action, status: result.status },
  });

  return result;
}
