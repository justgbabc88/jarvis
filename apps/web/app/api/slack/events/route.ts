import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getProviderCreds } from "@/lib/connectors";
import {
  SlackCreds,
  verifySlackSignature,
  postSlackChannel,
} from "@/lib/connectors/slack";
import { answerQuestion } from "@/lib/jarvis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Slack Events API endpoint — DM the Jarvis bot (or @mention it) and it
 * answers with live business context. Public route; authenticity is
 * enforced with Slack's signing secret, not the app session.
 *
 * Slack demands a 200 within 3 seconds, so the Claude call happens in
 * after() — we ack first, then post the reply via chat.postMessage.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const body = JSON.parse(raw || "{}");

  // One-time URL verification handshake when saving the Request URL.
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

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

  // Slack retries on slow acks; we already handled the original.
  if (req.headers.get("x-slack-retry-num")) return NextResponse.json({ ok: true });

  const event = body.event || {};
  const isDm = event.type === "message" && event.channel_type === "im";
  const isMention = event.type === "app_mention";
  // Ignore the bot's own messages and message edits/joins.
  if ((!isDm && !isMention) || event.bot_id || (isDm && event.subtype)) {
    return NextResponse.json({ ok: true });
  }

  const text = String(event.text || "")
    .replace(/<@[A-Z0-9]+>/g, "") // strip the @Jarvis mention
    .trim();
  if (!text || !creds.bot_token) return NextResponse.json({ ok: true });

  const channel = String(event.channel);
  const threadTs = isMention ? String(event.ts) : undefined;

  after(async () => {
    try {
      const answer = await answerQuestion(text, "chat", {
        slackUserId: String(event.user || ""),
        audience: isMention ? "channel" : "dm",
      });
      await postSlackChannel(creds, channel, answer, threadTs);
    } catch (e: any) {
      console.error("[slack events] reply failed:", e.message);
      try {
        await postSlackChannel(creds, channel, `⚠️ I hit an error: ${e.message}`, threadTs);
      } catch {}
    }
  });

  return NextResponse.json({ ok: true });
}
