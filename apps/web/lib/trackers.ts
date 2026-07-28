import { supabaseAdmin } from "./supabase";
import { todayYmd, nDaysAgoYmd } from "./time";

/**
 * Trackers: owner-defined daily numbers ("cold outreach sent"), logged
 * via a one-tap form and totaled on the dashboard. The daily Slack
 * prompt asks for them; agents can create them from plain English.
 */

export type TrackerWithStats = {
  id: string;
  name: string;
  question: string | null;
  unit: string;
  is_active: boolean;
  today: number | null;   // null = not logged yet today
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
    .select("tracker_id, entry_date, value")
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
      today: todayRow ? Number(todayRow.value) : null,
      last7: mine.filter((e) => e.entry_date >= weekAgo).reduce((a, e) => a + Number(e.value), 0),
      total: mine.reduce((a, e) => a + Number(e.value), 0),
    };
  });
}

export async function createTracker(opts: {
  name: string;
  question?: string;
  unit?: string;
  business_id?: string | null;
}): Promise<{ id: string; name: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("trackers")
    .insert({
      name: opts.name.slice(0, 120),
      question: opts.question || `How many "${opts.name}" today?`,
      unit: opts.unit || "count",
      business_id: opts.business_id || null,
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);

  await db.from("activity_log").insert({
    type: "tracker",
    summary: `Created tracker “${data.name}”.`,
    meta: { tracker_id: data.id },
  });
  return data;
}

export async function logTrackerEntry(
  trackerId: string,
  value: number,
  opts: { date?: string; note?: string } = {}
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("tracker_entries")
    .upsert(
      {
        tracker_id: trackerId,
        entry_date: opts.date || todayYmd(),
        value,
        note: opts.note || null,
      },
      { onConflict: "tracker_id,entry_date" }
    );
  if (error) throw new Error(error.message);
}
