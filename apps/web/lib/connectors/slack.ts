import crypto from "node:crypto";

/**
 * Slack — three credential pieces, all from one Slack app:
 *   webhook_url     Incoming Webhook. Outbound notifications (briefing,
 *                   reports, tracker prompts, approval cards).
 *   bot_token       xoxb-… with chat:write. Lets Jarvis REPLY when you
 *                   DM or @mention it (two-way chat).
 *   signing_secret  Verifies that events/button clicks hitting our
 *                   public endpoints really come from Slack.
 *
 * Webhook alone = notifications only. Add the other two for
 * conversations and Approve/Reject buttons.
 */

export type SlackCreds = {
  webhook_url?: string;
  bot_token?: string;
  signing_secret?: string;
};

export type SlackBlock = Record<string, unknown>;

/** Post via the incoming webhook (text and/or Block Kit blocks). */
export async function postSlack(
  creds: SlackCreds,
  text: string,
  blocks?: SlackBlock[]
): Promise<void> {
  if (!creds?.webhook_url || !/^https:\/\/hooks\.slack\.com\//.test(creds.webhook_url)) {
    throw new Error("a Slack incoming webhook URL is required (https://hooks.slack.com/…)");
  }
  const res = await fetch(creds.webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blocks ? { text, blocks } : { text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook error (${res.status}): ${body || "check the URL"}`);
  }
}

/** Post to a specific channel/DM with the bot token (used for replies). */
export async function postSlackChannel(
  creds: SlackCreds,
  channel: string,
  text: string,
  threadTs?: string
): Promise<void> {
  if (!creds?.bot_token) throw new Error("no bot token configured");
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${creds.bot_token}`,
    },
    body: JSON.stringify({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Slack chat.postMessage failed: ${json.error || res.status}`);
}

/** Who is the bot? Used by the Test button and to ignore our own messages. */
export async function slackAuthTest(creds: SlackCreds): Promise<{ user: string; team: string; user_id: string }> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.bot_token}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`bot token check failed: ${json.error || res.status}`);
  return { user: json.user, team: json.team, user_id: json.user_id };
}

/**
 * Verify Slack's request signature (v0 HMAC-SHA256 over "v0:ts:body").
 * Rejects requests older than 5 minutes (replay protection).
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string
): boolean {
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", signingSecret).update(base, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Live check for the Connections "Test" button. */
export async function verifySlack(creds: SlackCreds): Promise<string> {
  const parts: string[] = [];
  if (creds.webhook_url) {
    await postSlack(creds, "✅ Jarvis connected to this channel.");
    parts.push("webhook works (check the channel)");
  }
  if (creds.bot_token) {
    const who = await slackAuthTest(creds);
    parts.push(`bot @${who.user} authenticated in ${who.team}`);
  }
  if (parts.length === 0) throw new Error("add a webhook URL (and optionally a bot token)");
  if (creds.bot_token && !creds.signing_secret) {
    parts.push("⚠ add the signing secret too or Slack chat/buttons can't be verified");
  }
  return parts.join("; ");
}
