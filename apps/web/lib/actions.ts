import { supabaseAdmin } from "./supabase";
import { getProviderCreds } from "./connectors";
import { sendEmail, EmailCreds } from "./connectors/email";
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
  const res = await sendEmail(creds, {
    to: String(payload.to || ""),
    subject: String(payload.subject || ""),
    body: String(payload.body || payload.text || ""),
    cc: payload.cc ? String(payload.cc) : undefined,
    bcc: payload.bcc ? String(payload.bcc) : undefined,
  });
  return {
    status: "executed",
    message: `Email sent to ${payload.to}.`,
    detail: { message_id: res.messageId, accepted: res.accepted },
  };
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
export async function executeApproval(approval: {
  id: string;
  title: string;
  payload: any;
  agent_id?: string | null;
  agent_run_id?: string | null;
}): Promise<ExecutionResult> {
  const action = String(approval.payload?.action || "");
  let result: ExecutionResult;

  try {
    if (action === "email.send") result = await execEmailSend(approval.payload);
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
