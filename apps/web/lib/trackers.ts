import { supabaseAdmin } from "./supabase";
import { todayYmd, nDaysAgoYmd } from "./time";

/**
 * Trackers: owner-defined daily numbers ("cold outreach sent"), logged
 * via a one-tap form and totaled on the dashboard.
 *
 * A tracker can be a single number, or a FORM with multiple named
 * fields (e.g. five outreach metrics). Each tracker can post its own
 * daily Slack prompt to a chosen channel at a chosen time, @mentioning
 * the person who fills it out.
 */

export type TrackerField = { key: string; label: string; target?: number };

export type TrackerSlack = {
  channel?: string;        // "#general" (display)
  channel_id?: string;     // resolved C…
  prompt_time?: string;    // "16:00" in APP_TIMEZONE
  mention?: string;        // "<@U…>"
  mention_name?: string;   // "Dwight"
  last_prompt_date?: string;
  // Owner-authored template posted to the channel when the form is
  // submitted. Placeholders: {mention} {name} {total}
  on_submit_message?: string;
  // OR: owner guidance for a FRESH AI-written message on each submission
  // (varied daily, persona-aware, references the day's numbers).
  on_submit_prompt?: string;
  // Last few generated messages, kept so each new one avoids repeating.
  recent_praise?: string[];
};

export type TrackerWithStats = {
  id: string;
  name: string;
  question: string | null;
  unit: string;
  is_active: boolean;
  fields: TrackerField[];
  slack: TrackerSlack;
  today: number | null;   // null = not logged yet today
  todayValues: Record<string, number> | null;
  last7: number;
  total: number;
};

export async function listTrackersWithStats(activeOnly = true): Promise<TrackerWithStats[]> {
  const db = supabaseAdmin();
  let q = db.from("trackers").select("*").order("created_at");
  if (activeOnly) q = q.eq("is_active", true);
  const { data: trackers } = await q;
  if (!trackers?.length) return [];

  const { data: entries } = await db
    .from("tracker_entries")
    .select("tracker_id, entry_date, value, values")
    .in("tracker_id", trackers.map((t: any) => t.id));

  const today = todayYmd();
  const weekAgo = nDaysAgoYmd(6);

  return (trackers as any[]).map((t) => {
    const mine = ((entries as any[]) || []).filter((e) => e.tracker_id === t.id);
    const todayRow = mine.find((e) => e.entry_date === today);
    return {
      id: t.id,
      name: t.name,
      question: t.question,
      unit: t.unit,
      is_active: t.is_active,
      fields: Array.isArray(t.fields) ? t.fields : [],
      slack: t.slack || {},
      today: todayRow ? Number(todayRow.value) : null,
      todayValues: todayRow?.values && Object.keys(todayRow.values).length ? todayRow.values : null,
      last7: mine.filter((e) => e.entry_date >= weekAgo).reduce((a, e) => a + Number(e.value), 0),
      total: mine.reduce((a, e) => a + Number(e.value), 0),
    };
  });
}

export async function getTracker(id: string): Promise<any | null> {
  const db = supabaseAdmin();
  const { data } = await db.from("trackers").select("*").eq("id", id).maybeSingle();
  return data;
}

/** Turn a field label into a stable key: "DMs from IG" → "dms_from_ig". */
function fieldKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "field";
}

export async function createTracker(opts: {
  name: string;
  question?: string;
  unit?: string;
  business_id?: string | null;
  fields?: (TrackerField | string)[];
  slack?: TrackerSlack;
}): Promise<{ id: string; name: string }> {
  const db = supabaseAdmin();
  const fields: TrackerField[] = (opts.fields || []).map((f) =>
    typeof f === "string" ? { key: fieldKey(f), label: f } : { ...f, key: f.key || fieldKey(f.label) }
  );
  const { data, error } = await db
    .from("trackers")
    .insert({
      name: opts.name.slice(0, 120),
      question: opts.question || `How many "${opts.name}" today?`,
      unit: opts.unit || "count",
      business_id: opts.business_id || null,
      fields,
      slack: opts.slack || {},
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);

  await db.from("activity_log").insert({
    type: "tracker",
    summary: `Created tracker “${data.name}”${fields.length ? ` with ${fields.length} fields` : ""}.`,
    meta: { tracker_id: data.id },
  });
  return data;
}

/** Update name/question/fields/slack config on an existing tracker. */
export async function updateTracker(
  id: string,
  patch: Partial<{ name: string; question: string; fields: (TrackerField | string)[]; slack: TrackerSlack; is_active: boolean }>
): Promise<void> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name) update.name = String(patch.name).slice(0, 120);
  if (patch.question) update.question = String(patch.question).slice(0, 300);
  if (patch.is_active !== undefined) update.is_active = patch.is_active;
  if (patch.fields) {
    update.fields = patch.fields.map((f) =>
      typeof f === "string" ? { key: fieldKey(f), label: f } : { ...f, key: f.key || fieldKey(f.label) }
    );
  }
  if (patch.slack) {
    const { data: cur } = await db.from("trackers").select("slack").eq("id", id).single();
    update.slack = { ...(cur?.slack || {}), ...patch.slack };
  }
  const { error } = await db.from("trackers").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Log a day's numbers. For multi-field trackers pass `values`
 * ({field_key: n}); `value` (the daily total) is derived if omitted.
 */
export async function logTrackerEntry(
  trackerId: string,
  value: number | null,
  opts: { date?: string; note?: string; values?: Record<string, number> } = {}
): Promise<void> {
  const db = supabaseAdmin();
  const values = opts.values || {};
  const total =
    value != null && isFinite(value)
      ? value
      : Object.values(values).reduce((a, v) => a + (Number(v) || 0), 0);
  const { error } = await db
    .from("tracker_entries")
    .upsert(
      {
        tracker_id: trackerId,
        entry_date: opts.date || todayYmd(),
        value: total,
        values,
        note: opts.note || null,
      },
      { onConflict: "tracker_id,entry_date" }
    );
  if (error) throw new Error(error.message);
}
