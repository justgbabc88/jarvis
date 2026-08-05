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
export async function slackAuthTest(
  creds: SlackCreds
): Promise<{ user: string; team: string; user_id: string; scopes: string[] }> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.bot_token}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`bot token check failed: ${json.error || res.status}`);
  // Slack reports the token's ACTUAL granted scopes in this header —
  // the source of truth, regardless of what the app config page shows.
  const scopes = (res.headers.get("x-oauth-scopes") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return { user: json.user, team: json.team, user_id: json.user_id, scopes };
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

async function slackApi(creds: SlackCreds, method: string, params: Record<string, string> = {}): Promise<any> {
  if (!creds?.bot_token) throw new Error("no bot token configured");
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${creds.bot_token}` } });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error || res.status}`);
  return json;
}

/**
 * "#general" → channel id. Needs the channels:read scope. The bot must
 * also be a member of the channel to post there (invite it with /invite).
 */
export async function resolveSlackChannel(creds: SlackCreds, name: string): Promise<{ id: string; name: string }> {
  const wanted = name.replace(/^#/, "").toLowerCase();
  if (/^C[A-Z0-9]{6,}$/i.test(name)) return { id: name, name };

  // Public channels first (channels:read). Asking for private channels in
  // the same call requires groups:read and makes Slack reject the WHOLE
  // request with missing_scope — so try them separately, best-effort.
  for (const types of ["public_channel", "private_channel"]) {
    let cursor = "";
    try {
      for (let i = 0; i < 10; i++) {
        const j = await slackApi(creds, "conversations.list", {
          types,
          limit: "200",
          exclude_archived: "true",
          ...(cursor ? { cursor } : {}),
        });
        const hit = (j.channels || []).find((c: any) => c.name?.toLowerCase() === wanted);
        if (hit) return { id: hit.id, name: hit.name };
        cursor = j.response_metadata?.next_cursor || "";
        if (!cursor) break;
      }
    } catch (e: any) {
      // groups:read not granted → skip private channels silently.
      if (types === "public_channel") throw e;
    }
  }
  throw new Error(
    `channel "${name}" not found among channels the bot can see. If it's a private channel, ` +
      `add the groups:read scope and /invite the bot; if public, check the exact name.`
  );
}

/** "Dwight" → member id for an <@U…> mention. Needs the users:read scope. */
export async function resolveSlackUser(creds: SlackCreds, name: string): Promise<{ id: string; name: string }> {
  if (/^U[A-Z0-9]{6,}$/i.test(name)) return { id: name, name };
  const wanted = name.replace(/^@/, "").toLowerCase();
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const j = await slackApi(creds, "users.list", { limit: "200", ...(cursor ? { cursor } : {}) });
    const hit = (j.members || []).find(
      (m: any) =>
        !m.deleted &&
        !m.is_bot &&
        [m.name, m.real_name, m.profile?.display_name, m.profile?.real_name]
          .filter(Boolean)
          .some((n: string) => n.toLowerCase().includes(wanted))
    );
    if (hit) return { id: hit.id, name: hit.profile?.display_name || hit.real_name || hit.name };
    cursor = j.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  throw new Error(`user "${name}" not found (is the app missing the users:read scope?)`);
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
    const want = ["chat:write", "im:history", "app_mentions:read", "channels:read", "users:read"];
    const missing = want.filter((s) => !who.scopes.includes(s));
    parts.push(
      missing.length
        ? `⚠ token is missing scopes: ${missing.join(", ")} — reinstall the Slack app, then re-save this connection`
        : "all scopes granted ✓"
    );
  }
  if (parts.length === 0) throw new Error("add a webhook URL (and optionally a bot token)");
  if (creds.bot_token && !creds.signing_secret) {
    parts.push("⚠ add the signing secret too or Slack chat/buttons can't be verified");
  }
  return parts.join("; ");
}
