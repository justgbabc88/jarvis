import { supabaseAdmin } from "./supabase";
import { getBusinessMetrics } from "./connectors";
import { listBusinesses } from "./data";
import { monthStartYmd, todayYmd } from "./time";

/**
 * Pull revenue (NMI) + ad spend (Meta) for every active business for the
 * current month, day-by-day, and upsert into metric_snapshots. Returns a
 * per-business result so the caller can report/log.
 */
export async function syncAllBusinesses(range?: { since: string; until: string }) {
  const db = supabaseAdmin();
  const businesses = await listBusinesses(true);
  const since = range?.since || monthStartYmd();
  const until = range?.until || todayYmd();

  const results: { businessId: string; name: string; errors: string[]; days: number }[] = [];

  for (const b of businesses) {
    const m = await getBusinessMetrics(b.id, { since, until });

    // Merge revenue + spend by date into one row per day.
    const byDate = new Map<string, { revenue_cents: number; ad_spend_cents: number }>();
    for (const r of m.revenueByDay) {
      const e = byDate.get(r.date) || { revenue_cents: 0, ad_spend_cents: 0 };
      e.revenue_cents += r.cents;
      byDate.set(r.date, e);
    }
    for (const s of m.spendByDay) {
      const e = byDate.get(s.date) || { revenue_cents: 0, ad_spend_cents: 0 };
      e.ad_spend_cents += s.cents;
      byDate.set(s.date, e);
    }

    const rows = [...byDate.entries()].map(([metric_date, v]) => ({
      business_id: b.id,
      metric_date,
      revenue_cents: v.revenue_cents,
      ad_spend_cents: v.ad_spend_cents,
      source: [m.connected.nmi && "nmi", m.connected.meta && "meta"].filter(Boolean).join("+") || "none",
    }));

    if (rows.length > 0) {
      await db.from("metric_snapshots").upsert(rows, { onConflict: "business_id,metric_date" });
    }

    results.push({ businessId: b.id, name: b.name, errors: m.errors, days: rows.length });
  }

  // Log the sync so it surfaces under "what Jarvis did".
  const okCount = results.filter((r) => r.errors.length === 0).length;
  await db.from("activity_log").insert({
    type: "metric_sync",
    summary: `Synced revenue & ad spend for ${okCount}/${businesses.length} businesses.`,
    meta: { results },
  });

  return results;
}
