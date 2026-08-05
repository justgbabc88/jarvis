import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getProviderCreds } from "@/lib/connectors";
import { SlackCreds, verifySlackSignature } from "@/lib/connectors/slack";
import { executeApproval } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Slack interactivity endpoint — handles the Approve / Reject buttons on
 * approval cards. Approving here is identical to tapping "Approve & run"
 * in the app: the action executes immediately and the Slack message is
 * updated with the outcome.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  const creds = await getProviderCreds<SlackCreds>("slack");
  if (
    !creds?.signing_secret ||
    !verifySlackSignature(
      creds.signing_secret,
      req.headers.get("x-slack-request-timestamp"),
      req.headers.get("x-slack-signature"),
      raw
    )
  ) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payload = JSON.parse(new URLSearchParams(raw).get("payload") || "{}");
  if (payload.type !== "block_actions") return NextResponse.json({ ok: true });

  const action = payload.actions?.[0];
  const decision =
    action?.action_id === "approve_action"
      ? "approved"
      : action?.action_id === "reject_action"
        ? "rejected"
        : null;
  const approvalId = String(action?.value || "");
  const responseUrl = String(payload.response_url || "");
  if (!decision || !approvalId || !responseUrl) return NextResponse.json({ ok: true });

  after(async () => {
    const respond = (text: string) =>
      fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_original: true, text }),
      }).catch(() => {});

    const db = supabaseAdmin();
    const { data, error } = await db
      .from("approvals")
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq("id", approvalId)
      .eq("status", "pending")
      .select()
      .single();

    if (error || !data) {
      await respond("⚠️ That action was already decided (or no longer exists).");
      return;
    }

    await db.from("activity_log").insert({
      type: "approval",
      summary: `You ${decision} “${data.title}” from Slack.`,
      meta: { approval_id: approvalId, kind: data.kind, via: "slack" },
    });

    if (decision === "rejected") {
      await respond(`🚫 Rejected: “${data.title}”. Nothing was executed.`);
      return;
    }

    await respond(`⏳ Approved: “${data.title}” — executing…`);
    const result = await executeApproval(data, { notify: false });
    await respond(
      result.status === "executed"
        ? `✅ Done: “${data.title}” — ${result.message}`
        : result.status === "failed"
          ? `❌ “${data.title}” approved but execution failed: ${result.message}`
          : `☑️ Approved: “${data.title}” (${result.message})`
    );
  });

  return NextResponse.json({ ok: true });
}
