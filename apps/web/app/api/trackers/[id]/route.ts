import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { logTrackerEntry, getTracker, TrackerSlack } from "@/lib/trackers";

export const dynamic = "force-dynamic";

const LogSchema = z
  .object({
    value: z.number().finite().optional(),
    values: z.record(z.number().finite()).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.value !== undefined || d.values, { message: "provide value or values" });

/** Log (or overwrite) a day's numbers for this tracker. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = LogSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    await logTrackerEntry(id, parsed.data.value ?? null, parsed.data);

    // Owner-configured "on submit" message (e.g. praise when Dwight logs
    // his numbers): either a fixed template, or — with on_submit_prompt —
    // a fresh AI-written message each day that avoids repeating itself.
    after(async () => {
      try {
        const t = await getTracker(id);
        const s: TrackerSlack = t?.slack || {};
        if (!s.on_submit_message && !s.on_submit_prompt) return;
        const total =
          parsed.data.value ??
          Object.values(parsed.data.values || {}).reduce((a, v) => a + (Number(v) || 0), 0);

        let text: string | null = null;
        const recent: string[] = Array.isArray(s.recent_praise) ? s.recent_praise : [];

        if (s.on_submit_prompt) {
          try {
            const { ask } = await import("@/lib/anthropic");
            const { getPersona } = await import("@/lib/jarvis");
            const { getAssistantIdentity } = await import("@/lib/identity");
            const [persona, identity] = await Promise.all([getPersona(), getAssistantIdentity()]);
            const fields = Array.isArray(t.fields) ? t.fields : [];
            const values = parsed.data.values || {};
            const detail = fields.length
              ? fields
                  .map(
                    (f: any) =>
                      `- ${f.label}: ${values[f.key] ?? 0}${f.target ? ` (target ${f.target})` : ""}`
                  )
                  .join("\n")
              : `total: ${total}`;
            text = await ask({
              system: [
                `You are ${identity.name} posting one short Slack message (1–3 sentences, Slack formatting, no headers).`,
                persona ? `PERSONALITY (style only): ${persona}` : "",
                "Ground everything in the actual numbers provided. Never invent figures.",
              ].join(" "),
              prompt: [
                `Owner's instruction for this recurring message: ${s.on_submit_prompt}`,
                ``,
                `Today's "${t.name}" submission:`,
                detail,
                s.mention ? `Address them with ${s.mention}.` : "",
                ``,
                `Messages you already used on previous days — today's must be CLEARLY different in wording and angle:`,
                recent.map((r) => `- ${r}`).join("\n") || "(none yet — set the tone)",
              ].join("\n"),
              maxTokens: 300,
            });
          } catch (e: any) {
            console.error("[tracker] praise generation failed:", e.message);
            text = null;
          }
        }

        if (!text && s.on_submit_message) {
          text = s.on_submit_message
            .replaceAll("{mention}", s.mention || "")
            .replaceAll("{name}", t.name)
            .replaceAll("{total}", String(total));
        }
        if (!text) return;

        const { getProviderCreds } = await import("@/lib/connectors");
        const { postSlackChannel, postSlack } = await import("@/lib/connectors/slack");
        const creds = await getProviderCreds<any>("slack");
        if (!creds) return;
        if (s.channel_id && creds.bot_token) await postSlackChannel(creds, s.channel_id, text);
        else await postSlack(creds, text);

        // Remember what was said so tomorrow's message stays fresh.
        if (s.on_submit_prompt) {
          await supabaseAdmin()
            .from("trackers")
            .update({ slack: { ...s, recent_praise: [...recent, text].slice(-7) } })
            .eq("id", id);
        }
      } catch (e: any) {
        console.error("[tracker] on-submit message failed:", e.message);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** Archive (deactivate) a tracker; its history stays. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  const { error } = await db.from("trackers").update({ is_active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
