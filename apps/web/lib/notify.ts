import { getProviderCreds } from "./connectors";
import { postSlack, SlackCreds, SlackBlock } from "./connectors/slack";

/**
 * Owner notifications. Best-effort: if no Slack connection exists (or
 * the post fails) the caller carries on — notifications must never
 * break a briefing, agent run, or approval.
 */
export async function notifySlack(text: string): Promise<boolean> {
  try {
    const creds = await getProviderCreds<SlackCreds>("slack");
    if (!creds) return false;
    await postSlack(creds, text);
    return true;
  } catch (e) {
    console.error("[notify] slack post failed:", (e as Error).message);
    return false;
  }
}

/**
 * Approval card with Approve / Reject buttons. Tapping a button hits
 * /api/slack/interactive (signature-verified) and behaves exactly like
 * deciding in the app.
 */
export async function notifySlackApproval(approval: {
  id: string;
  kind: string;
  title: string;
  detail?: string | null;
  amount_cents?: number | null;
}): Promise<boolean> {
  const amount =
    approval.amount_cents != null ? ` · $${(approval.amount_cents / 100).toFixed(2)}` : "";
  const text = `🔒 Approval needed [${approval.kind}${amount}]: ${approval.title}`;
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔒 *Approval needed* · ${approval.kind}${amount}\n*${approval.title}*${
          approval.detail ? `\n${approval.detail.slice(0, 500)}` : ""
        }`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          action_id: "approve_action",
          value: approval.id,
          text: { type: "plain_text", text: "Approve & run" },
          confirm: {
            title: { type: "plain_text", text: "Run this action?" },
            text: { type: "mrkdwn", text: "It executes immediately after you confirm." },
            confirm: { type: "plain_text", text: "Yes, run it" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
        {
          type: "button",
          style: "danger",
          action_id: "reject_action",
          value: approval.id,
          text: { type: "plain_text", text: "Reject" },
        },
      ],
    },
  ];
  try {
    const creds = await getProviderCreds<SlackCreds>("slack");
    if (!creds?.webhook_url) return false;
    await postSlack(creds, text, blocks);
    return true;
  } catch (e) {
    console.error("[notify] slack approval card failed:", (e as Error).message);
    return false;
  }
}

/** Public URL of the app, for links in Slack messages. */
export function appUrl(path = ""): string {
  const base =
    process.env.APP_PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  return base ? `${base}${path}` : "";
}
