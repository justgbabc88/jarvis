import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getProviderCreds } from "@/lib/connectors";
import { SlackCreds, postSlackChannel, postSlack } from "@/lib/connectors/slack";
import { appUrl } from "@/lib/notify";
import { appTimezone, todayYmd } from "@/lib/time";
import { TrackerField, TrackerSlack } from "@/lib/trackers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by the Railway worker every minute. Any active tracker whose
 * slack.prompt_time matches the current minute (app timezone) gets its
 * prompt posted — to its own channel via the bot token when configured,
 * otherwise through the default webhook.
 */
export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || bearer !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const nowHm = new Intl.DateTimeFormat("en-GB", {
    timeZone: appTimezone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const today = todayYmd();

  const db = supabaseAdmin();
  const { data: trackers } = await db.from("trackers").select("*").eq("is_active", true);

  const due = ((trackers as any[]) || []).filter((t) => {
    const s: TrackerSlack = t.slack || {};
    return s.prompt_time === nowHm && s.last_prompt_date !== today;
  });
  if (due.length === 0) return NextResponse.json({ due: 0 });

  const creds = await getProviderCreds<SlackCreds>("slack");
  const results: any[] = [];

  for (const t of due) {
    const s: TrackerSlack = t.slack || {};
    const fields: TrackerField[] = Array.isArray(t.fields) ? t.fields : [];
    const link = appUrl(`/track/${t.id}`);
    const lines = [
      `${s.mention ? `${s.mention} ` : ""}📋 *${t.name}* — time to log today's numbers!`,
      ...fields.map((f) => `• ${f.label}${f.target ? ` (target: ${f.target})` : ""}`),
      link ? `Fill it out here: ${link}` : "Log it on the Jarvis dashboard.",
    ];
    const text = lines.join("\n");

    try {
      if (!creds) throw new Error("no Slack connection");
      if (s.channel_id && creds.bot_token) {
        await postSlackChannel(creds, s.channel_id, text);
      } else {
        await postSlack(creds, text); // default webhook channel
      }
      await db
        .from("trackers")
        .update({ slack: { ...s, last_prompt_date: today } })
        .eq("id", t.id);
      results.push({ tracker: t.name, ok: true });
    } catch (e: any) {
      results.push({ tracker: t.name, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ due: due.length, results });
}
