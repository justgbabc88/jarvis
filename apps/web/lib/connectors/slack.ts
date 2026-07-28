/**
 * Slack via an incoming webhook URL — free, no OAuth app needed.
 * Slack → api.slack.com/apps → your app → Incoming Webhooks → pick a
 * channel. The URL is the credential (it can only post to that channel).
 *
 * Used two ways:
 *  - notifications to the owner (briefing, agent reports, tracker prompts)
 *  - the `slack.post` approved action (agents draft, owner taps Approve)
 */

export type SlackCreds = { webhook_url: string };

export async function postSlack(creds: SlackCreds, text: string): Promise<void> {
  if (!creds?.webhook_url || !/^https:\/\/hooks\.slack\.com\//.test(creds.webhook_url)) {
    throw new Error("a Slack incoming webhook URL is required (https://hooks.slack.com/…)");
  }
  const res = await fetch(creds.webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook error (${res.status}): ${body || "check the URL"}`);
  }
}

/** Live check for the Connections "Test" button — posts a hello message. */
export async function verifySlack(creds: SlackCreds): Promise<void> {
  await postSlack(creds, "✅ Jarvis connected to this channel.");
}
